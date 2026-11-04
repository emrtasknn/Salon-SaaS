import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// CI only (isolated PostgreSQL 17, superuser connection). Never run locally
// against Pilot/production: this file writes and deletes rows.
const databaseUrl = process.env.DATABASE_URL;
const describeRateLimit = databaseUrl ? describe : describe.skip;

const FN = "private.rate_limit_hit($1::text, $2::text, $3::integer)";
const FN_SIGNATURE = "private.rate_limit_hit(text,text,integer)";
const TABLE = 'private."RateLimitBucket"';
const BUCKET = "test.rate_limit";

type HitRow = { hit_count: number; window_start: Date };

describeRateLimit("private.rate_limit_hit (WP-5)", () => {
  const suffix = randomUUID().replaceAll("-", "");
  /** No grants at all. */
  const strangerRole = `rl_stranger_${suffix}`;
  /** Non-superuser, NOBYPASSRLS caller granted USAGE + EXECUTE only. */
  const callerRole = `rl_caller_${suffix}`;
  /** Non-superuser, NOBYPASSRLS stand-in for a Supabase-like runtime owner. */
  const ownerRole = `rl_owner_${suffix}`;
  const createdRoles: string[] = [];
  const keys: string[] = [];

  let pool: Pool;

  const newKey = () => {
    const key = randomBytes(32).toString("hex");
    keys.push(key);
    return key;
  };

  const hit = async (client: Pool | PoolClient, key: string, windowSeconds = 3600, bucket = BUCKET) => {
    const result = await client.query<HitRow>(`SELECT hit_count, window_start FROM ${FN}`, [key, bucket, windowSeconds]);
    expect(result.rows).toHaveLength(1);
    return result.rows[0];
  };

  const storedRow = async (key: string) => {
    // Superuser connection in CI bypasses RLS.
    const result = await pool.query<{ count: number; window_start: Date }>(
      `SELECT "count", "window_start" FROM ${TABLE} WHERE "key" = $1`,
      [key],
    );
    return result.rows[0];
  };

  const sqlState = async (operation: Promise<unknown>) => {
    try {
      await operation;
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return "NO_ERROR";
  };

  /** Runs inside a transaction that is always rolled back. */
  const inRolledBackTx = async <T>(operation: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      return await operation(client);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("RESET ROLE").catch(() => undefined);
      client.release();
    }
  };

  /** Expects a failure with the given SQLSTATE inside a savepoint so the tx stays usable. */
  const expectSqlStateInTx = async (client: PoolClient, sql: string, params: unknown[], code: string) => {
    await client.query("SAVEPOINT expect_error");
    const state = await sqlState(client.query(sql, params));
    await client.query("ROLLBACK TO SAVEPOINT expect_error");
    expect(state).toBe(code);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000, max: 25 });

    for (const role of [strangerRole, callerRole, ownerRole]) {
      await pool.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
      createdRoles.push(role);
      await pool.query(`GRANT "${role}" TO CURRENT_USER WITH SET TRUE`);
    }
    await pool.query(`GRANT USAGE ON SCHEMA private TO "${callerRole}"`);
    await pool.query(`GRANT EXECUTE ON FUNCTION private.rate_limit_hit(TEXT, TEXT, INTEGER) TO "${callerRole}"`);
  });

  afterAll(async () => {
    if (!pool) return;
    const cleanupErrors: string[] = [];
    try {
      try {
        if (keys.length > 0) await pool.query(`DELETE FROM ${TABLE} WHERE "key" = ANY($1::text[])`, [keys]);
      } catch (error) {
        cleanupErrors.push(`key cleanup failed: ${String(error)}`);
      }
      for (const role of createdRoles) {
        try {
          await pool.query(`REVOKE ALL ON FUNCTION private.rate_limit_hit(TEXT, TEXT, INTEGER) FROM "${role}"`);
          await pool.query(`REVOKE ALL ON SCHEMA private FROM "${role}"`);
          await pool.query(`REVOKE ALL ON TABLE ${TABLE} FROM "${role}"`);
          await pool.query(`REVOKE "${role}" FROM CURRENT_USER`);
          await pool.query(`DROP ROLE IF EXISTS "${role}"`);
        } catch (error) {
          cleanupErrors.push(`role ${role} cleanup failed: ${String(error)}`);
        }
      }
    } finally {
      await pool.end();
    }
    if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join("\n"));
  });

  it("first hit on a fresh key returns 1 and the date_bin window start", async () => {
    const key = newKey();
    const result = await pool.query<HitRow & { expected: Date }>(
      `SELECT r.hit_count, r.window_start,
              date_bin(make_interval(secs => 60), now(), TIMESTAMPTZ '2000-01-01 00:00:00+00') AS expected
         FROM ${FN} r`,
      [key, BUCKET, 60],
    );
    expect(result.rows[0].hit_count).toBe(1);
    expect(result.rows[0].window_start.getTime()).toBe(result.rows[0].expected.getTime());
    expect((await storedRow(key))?.count).toBe(1);
  });

  it("counts sequential hits within one window", async () => {
    const key = newKey();
    const counts: number[] = [];
    const windows = new Set<number>();
    for (let i = 0; i < 5; i += 1) {
      const row = await hit(pool, key);
      counts.push(row.hit_count);
      windows.add(row.window_start.getTime());
    }
    expect(counts).toEqual([1, 2, 3, 4, 5]);
    expect(windows.size).toBe(1);
  });

  it("resets to 1 when the stored window is older (rollover)", async () => {
    const key = newKey();
    await pool.query(
      `INSERT INTO ${TABLE} ("key", "bucket", "window_start", "count") VALUES ($1, $2, now() - INTERVAL '2 hours', 7)`,
      [key, BUCKET],
    );
    const before = await storedRow(key);

    const row = await hit(pool, key, 60);

    expect(row.hit_count).toBe(1);
    expect(row.window_start.getTime()).toBeGreaterThan(before.window_start.getTime());
  });

  it("never resets or moves back a row from a newer (future) window", async () => {
    const key = newKey();
    const seeded = await pool.query<{ window_start: Date }>(
      `INSERT INTO ${TABLE} ("key", "bucket", "window_start", "count")
       VALUES ($1, $2, now() + INTERVAL '1 hour', 5) RETURNING "window_start"`,
      [key, BUCKET],
    );

    const row = await hit(pool, key, 60);

    expect(row.hit_count).toBe(6);
    expect(row.window_start.getTime()).toBe(seeded.rows[0].window_start.getTime());
  });

  it("is atomic under 20 parallel hits on separate connections", async () => {
    const key = newKey();
    const clients = await Promise.all(Array.from({ length: 20 }, () => pool.connect()));
    try {
      const rows = await Promise.all(clients.map((client) => hit(client, key)));
      expect(rows.map((row) => row.hit_count).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    } finally {
      for (const client of clients) client.release();
    }
    expect((await storedRow(key))?.count).toBe(20);
  });

  it.each([
    ["uppercase key", "A".repeat(64), BUCKET, 60],
    ["63-char key", "a".repeat(63), BUCKET, 60],
    ["65-char key", "a".repeat(65), BUCKET, 60],
    ["NULL key", null, BUCKET, 60],
    ["bucket starting with a digit", "a".repeat(64), "1abc", 60],
    ["uppercase bucket", "a".repeat(64), "A", 60],
    ["65-char bucket", "a".repeat(64), "a".repeat(65), 60],
    ["NULL bucket", "a".repeat(64), null, 60],
    ["window 0", "a".repeat(64), BUCKET, 0],
    ["window 86401", "a".repeat(64), BUCKET, 86401],
    ["NULL window", "a".repeat(64), BUCKET, null],
  ])("rejects %s with SQLSTATE 22023", async (_label, key, bucket, windowSeconds) => {
    expect(await sqlState(pool.query(`SELECT * FROM ${FN}`, [key, bucket, windowSeconds]))).toBe("22023");
  });

  it("does not store a row for rejected input", async () => {
    const result = await pool.query(`SELECT 1 FROM ${TABLE} WHERE "key" = $1`, ["a".repeat(64)]);
    expect(result.rowCount).toBe(0);
  });

  it("grants EXECUTE to postgres and not to PUBLIC-only roles", async () => {
    const result = await pool.query<{ postgres_exec: boolean; stranger_exec: boolean; stranger_select: boolean }>(
      `SELECT has_function_privilege('postgres', $1, 'EXECUTE') AS postgres_exec,
              has_function_privilege($2, $1, 'EXECUTE') AS stranger_exec,
              has_table_privilege($2, '${TABLE}', 'SELECT') AS stranger_select`,
      [FN_SIGNATURE, strangerRole],
    );
    expect(result.rows[0]).toEqual({ postgres_exec: true, stranger_exec: false, stranger_select: false });
  });

  it("denies a role without grants: no EXECUTE, SELECT or INSERT (42501)", async () => {
    await inRolledBackTx(async (client) => {
      await client.query(`SET ROLE "${strangerRole}"`);
      await expectSqlStateInTx(client, `SELECT * FROM ${FN}`, ["b".repeat(64), BUCKET, 60], "42501");
      await expectSqlStateInTx(client, `SELECT * FROM ${TABLE}`, [], "42501");
      await expectSqlStateInTx(
        client,
        `INSERT INTO ${TABLE} ("key", "bucket", "window_start", "count") VALUES ($1, $2, now(), 1)`,
        ["b".repeat(64), BUCKET],
        "42501",
      );
    });
  });

  it("keeps rows hidden under FORCE RLS even with test-only table grants", async () => {
    const key = newKey();
    await hit(pool, key);

    await inRolledBackTx(async (client) => {
      await client.query(`GRANT USAGE ON SCHEMA private TO "${strangerRole}"`);
      await client.query(`GRANT SELECT, INSERT ON ${TABLE} TO "${strangerRole}"`);
      await client.query(`SET ROLE "${strangerRole}"`);
      // Even with the flag set: the policy is TO postgres only.
      await client.query("SELECT set_config('app.rate_limit_access', 'on', true)");
      const visible = await client.query(`SELECT 1 FROM ${TABLE} WHERE "key" = $1`, [key]);
      expect(visible.rowCount).toBe(0);
      await expectSqlStateInTx(
        client,
        `INSERT INTO ${TABLE} ("key", "bucket", "window_start", "count") VALUES ($1, $2, now(), 1)`,
        ["c".repeat(64), BUCKET],
        "42501",
      );
    });
  });

  it("lets a non-superuser NOBYPASSRLS caller hit via the function only", async () => {
    const key = newKey();
    await inRolledBackTx(async (client) => {
      await client.query(`SET ROLE "${callerRole}"`);
      const roleInfo = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      );
      expect(roleInfo.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

      expect((await hit(client, key)).hit_count).toBe(1);
      expect((await hit(client, key)).hit_count).toBe(2);
      await expectSqlStateInTx(client, `SELECT * FROM ${TABLE}`, [], "42501");
      await expectSqlStateInTx(
        client,
        `INSERT INTO ${TABLE} ("key", "bucket", "window_start", "count") VALUES ($1, $2, now(), 1)`,
        ["d".repeat(64), BUCKET],
        "42501",
      );
    });
  });

  it("works through the flag policy when the function owner has no BYPASSRLS (Supabase-like)", async () => {
    // CI connects as a superuser, so the default owner bypasses RLS. Here the
    // function is temporarily owned by a NOSUPERUSER NOBYPASSRLS member of
    // postgres (policy role), inside a rolled-back transaction.
    const key = randomBytes(32).toString("hex"); // never committed
    await inRolledBackTx(async (client) => {
      await client.query(`GRANT postgres TO "${ownerRole}"`);
      await client.query(`ALTER FUNCTION private.rate_limit_hit(TEXT, TEXT, INTEGER) OWNER TO "${ownerRole}"`);
      await client.query(`SET ROLE "${callerRole}"`);

      expect((await hit(client, key)).hit_count).toBe(1);
      expect((await hit(client, key)).hit_count).toBe(2);
      const flag = await client.query<{ flag: string | null }>(
        "SELECT current_setting('app.rate_limit_access', true) AS flag",
      );
      expect(flag.rows[0].flag ?? "").toBe("");

      // Owner-equivalent role without the flag: FORCE RLS hides rows, insert denied.
      await client.query("RESET ROLE");
      await client.query(`SET ROLE "${ownerRole}"`);
      const hidden = await client.query(`SELECT "count" FROM ${TABLE} WHERE "key" = $1`, [key]);
      expect(hidden.rowCount).toBe(0);
      await expectSqlStateInTx(
        client,
        `INSERT INTO ${TABLE} ("key", "bucket", "window_start", "count") VALUES ($1, $2, now(), 1)`,
        ["e".repeat(64), BUCKET],
        "42501",
      );

      // Caveat 2 (WP-05.md): the runtime role could set the flag itself.
      await client.query("SELECT set_config('app.rate_limit_access', 'on', true)");
      const visible = await client.query<{ count: number }>(`SELECT "count" FROM ${TABLE} WHERE "key" = $1`, [key]);
      expect(visible.rows).toEqual([{ count: 2 }]);
    });
    expect(await storedRow(key)).toBeUndefined();
  });

  it("clears the access flag before returning (same transaction)", async () => {
    const key = newKey();
    await inRolledBackTx(async (client) => {
      await hit(client, key);
      const flag = await client.query<{ flag: string | null }>(
        "SELECT current_setting('app.rate_limit_access', true) AS flag",
      );
      expect(flag.rows[0].flag ?? "").toBe("");
    });
  });

  it("opportunistic cleanup deletes rows older than 1 day but never the current window", async () => {
    const expiredKey = newKey();
    const currentKey = newKey();
    await pool.query(
      `INSERT INTO ${TABLE} ("key", "bucket", "window_start", "count") VALUES ($1, $2, now() - INTERVAL '2 days', 3)`,
      [expiredKey, BUCKET],
    );
    await hit(pool, currentKey);

    // Cleanup runs on ~1% of calls; 0.99^3000 ≈ 1e-13 chance of a false failure.
    let attempts = 0;
    while (attempts < 3000 && (await storedRow(expiredKey)) !== undefined) {
      await hit(pool, currentKey);
      attempts += 1;
    }

    expect(await storedRow(expiredKey)).toBeUndefined();
    expect((await storedRow(currentKey))?.count).toBe(attempts + 1);
  }, 120_000);
});
