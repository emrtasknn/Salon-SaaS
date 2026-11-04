import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// WP-10: two-tenant integration test for "AppointmentContact" (RLS, FKs, CHECKs) and the
// Tenant KVKK legal-field CHECKs from migration 20261106100000_kvkk_notice_whatsapp_optin.
// CI only (isolated PostgreSQL); skipped without DATABASE_URL.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const TABLE = "AppointmentContact";
const NOW_UTC = `(now() AT TIME ZONE 'UTC')`;
const HASH_NOTICE = "a".repeat(64);
const HASH_OPTIN = "b".repeat(64);
// `timestamp(3)` columns hold UTC wall time; plain literals avoid client-TZ conversion.
const T_NOTICE = "2026-11-06 10:00:00.000";
const T_OPTIN = "2026-11-06 10:00:01.000";
const T_BEFORE_OPTIN = "2026-11-06 09:59:59.000";

type TenantFixture = {
  tenantId: string;
  slug: string;
  customerProfileId: string;
  staffProfileId: string;
  staffId: string;
  serviceId: string;
};

type ContactRow = Record<string, string | boolean | null>;

type Ctx = Readonly<{ tenantId: string | null; asRole: boolean }>;

function makeFixture(label: string): TenantFixture {
  const suffix = randomUUID();
  return {
    tenantId: `contact-${label}-${suffix}`,
    slug: `contact-${label}-${suffix}`,
    customerProfileId: `contact-customer-${label}-${suffix}`,
    staffProfileId: `contact-staff-profile-${label}-${suffix}`,
    staffId: `contact-staff-${label}-${suffix}`,
    serviceId: `contact-service-${label}-${suffix}`,
  };
}

/** Valid PUBLIC_FORM row without opt-in; override fields to build each case. */
function publicFormRow(tenantId: string, appointmentId: string, overrides: ContactRow = {}): ContactRow {
  return {
    id: `contact-${randomUUID()}`,
    tenantId,
    appointmentId,
    source: "PUBLIC_FORM",
    displayName: "Ayşe Yılmaz",
    email: "ayse@example.test",
    phone: null,
    noticeVersion: "2026-11-draft",
    noticeHash: HASH_NOTICE,
    noticeShownAt: T_NOTICE,
    whatsappOptIn: false,
    optInVersion: null,
    optInHash: null,
    optInAt: null,
    optInRecordedByProfileId: null,
    optOutAt: null,
    ...overrides,
  };
}

const OPT_IN_FIELDS: ContactRow = {
  phone: "+905551112233",
  whatsappOptIn: true,
  optInVersion: "2026-11-draft",
  optInHash: HASH_OPTIN,
  optInAt: T_OPTIN,
};

/** Valid STAFF row without notice and without opt-in. */
function staffRow(tenantId: string, appointmentId: string, overrides: ContactRow = {}): ContactRow {
  return publicFormRow(tenantId, appointmentId, {
    source: "STAFF",
    noticeVersion: null,
    noticeHash: null,
    noticeShownAt: null,
    ...overrides,
  });
}

function insertContact(c: PoolClient, row: ContactRow) {
  const columns = Object.keys(row);
  const sql = `INSERT INTO "${TABLE}" (${columns.map((col) => `"${col}"`).join(", ")}, "createdAt")
               VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}, now())`;
  return c.query(sql, Object.values(row));
}

describeDatabase("AppointmentContact tenant isolation and constraints integration", () => {
  const role = `appointment_contact_test_runner_${randomUUID().replaceAll("-", "")}`;
  const tenantA = makeFixture("a");
  const tenantB = makeFixture("b");

  let pool: Pool | undefined;
  let roleCreated = false;

  // Appointments with a persisted contact row, and appointments left free for inserts.
  let aContactAppointmentId: string;
  let aContactId: string;
  let aFreeAppointmentId: string;
  let bContactAppointmentId: string;
  let bContactId: string;

  const db = () => {
    if (!pool) throw new Error("Database pool was not initialized");
    return pool;
  };

  /** Runs `operation` in a transaction that is always rolled back. `asRole` drops superuser/owner bypass. */
  const inRolledBackTx = async <T>(options: Ctx, operation: (c: PoolClient) => Promise<T>): Promise<T> => {
    const c = await db().connect();
    try {
      await c.query("BEGIN");
      if (options.asRole) await c.query(`SET LOCAL ROLE "${role}"`);
      if (options.tenantId) await c.query("SELECT set_config('app.tenant_id', $1, true)", [options.tenantId]);
      return await operation(c);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      await c.query("RESET ROLE").catch(() => undefined);
      c.release();
    }
  };

  const expectPgError = async (options: Ctx, sql: string, params: unknown[], expected: Record<string, string>) => {
    await expect(inRolledBackTx(options, (c) => c.query(sql, params))).rejects.toMatchObject(expected);
  };

  const expectContactRejected = async (options: Ctx, row: ContactRow, expected: Record<string, string>) => {
    await expect(inRolledBackTx(options, (c) => insertContact(c, row))).rejects.toMatchObject(expected);
  };

  const expectContactAccepted = async (options: Ctx, row: ContactRow) => {
    const result = await inRolledBackTx(options, (c) => insertContact(c, row));
    expect(result.rowCount).toBe(1);
  };

  const seedTenant = async (fixture: TenantFixture, label: string) => {
    const p = db();
    await p.query(
      `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Europe/Istanbul', now(), now())`,
      [fixture.tenantId, fixture.slug, `Contact Salon ${label}`],
    );
    await p.query(
      `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now()), ($4, $2, $5, now(), now())`,
      [fixture.customerProfileId, fixture.tenantId, `Customer ${label}`, fixture.staffProfileId, `Staff ${label}`],
    );
    await p.query(
      `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [fixture.staffId, fixture.tenantId, fixture.staffProfileId],
    );
    await p.query(
      `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 30, 0, true, now(), now())`,
      [fixture.serviceId, fixture.tenantId, `Service ${label}`],
    );
  };

  const seedAppointment = async (fixture: TenantFixture, startsIn: string): Promise<string> => {
    const appointmentId = `contact-appointment-${randomUUID()}`;
    await db().query(
      `INSERT INTO "Appointment"
        ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'PENDING',
               ${NOW_UTC} + $6::interval, ${NOW_UTC} + $6::interval + interval '30 minutes', now(), now())`,
      [appointmentId, fixture.tenantId, fixture.staffId, fixture.serviceId, fixture.customerProfileId, startsIn],
    );
    return appointmentId;
  };

  /** Persists a valid PUBLIC_FORM contact (with opt-in) as the bypassing owner. */
  const seedContact = async (fixture: TenantFixture, appointmentId: string): Promise<string> => {
    const row = publicFormRow(fixture.tenantId, appointmentId, OPT_IN_FIELDS);
    const c = await db().connect();
    try {
      await insertContact(c, row);
    } finally {
      c.release();
    }
    return row.id as string;
  };

  const contactRow = async (id: string) => {
    const result = await db().query(
      `SELECT "tenantId", "displayName", "optOutAt" IS NULL AS "notOptedOut" FROM "${TABLE}" WHERE "id" = $1`,
      [id],
    );
    return result.rows[0] as { tenantId: string; displayName: string; notOptedOut: boolean } | undefined;
  };

  const cleanupTenant = async (fixture: TenantFixture) => {
    const p = db();
    // Contacts first: the composite FKs to Appointment and Profile are ON DELETE RESTRICT.
    await p.query(`DELETE FROM "${TABLE}" WHERE "tenantId" = $1`, [fixture.tenantId]);
    await p.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Service" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
    await p.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });

    // Non-owner, non-superuser role so RLS is actually evaluated (CI connects as a superuser).
    // Same one-directional grant pattern as the WP-06 access-token test (no circular grants).
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
    roleCreated = true;
    await pool.query(`GRANT "${role}" TO CURRENT_USER WITH SET TRUE`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${TABLE}" TO "${role}"`);

    await seedTenant(tenantA, "A");
    await seedTenant(tenantB, "B");

    aContactAppointmentId = await seedAppointment(tenantA, "2 days");
    aFreeAppointmentId = await seedAppointment(tenantA, "2 days 1 hour");
    bContactAppointmentId = await seedAppointment(tenantB, "2 days");
    aContactId = await seedContact(tenantA, aContactAppointmentId);
    bContactId = await seedContact(tenantB, bContactAppointmentId);
  });

  afterAll(async () => {
    if (!pool) return;
    const cleanupErrors: string[] = [];
    for (const fixture of [tenantA, tenantB]) {
      try {
        await cleanupTenant(fixture);
      } catch (error) {
        cleanupErrors.push(`cleanup failed for ${fixture.tenantId}: ${String(error)}`);
      }
    }
    if (roleCreated) {
      try {
        await pool.query(`REVOKE SELECT, INSERT, UPDATE, DELETE ON "${TABLE}" FROM "${role}"`);
        await pool.query(`REVOKE USAGE ON SCHEMA public FROM "${role}"`);
        await pool.query(`REVOKE "${role}" FROM CURRENT_USER`);
        await pool.query(`DROP ROLE IF EXISTS "${role}"`);
      } catch (error) {
        cleanupErrors.push(`test role cleanup failed: ${String(error)}`);
      }
    }
    try {
      await pool.end();
    } catch (error) {
      cleanupErrors.push(`PostgreSQL pool shutdown failed: ${String(error)}`);
    }
    if (cleanupErrors.length) throw new Error(cleanupErrors.join("\n"));
  });

  describe("schema and RLS", () => {
    it("has RLS enabled and forced, with the four tenant-isolation policies", async () => {
      const rls = await db().query(
        `SELECT c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = $1`,
        [TABLE],
      );
      expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);

      const policies = await db().query(
        `SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY policyname`,
        [TABLE],
      );
      expect(policies.rows).toEqual([
        { policyname: "appointment_contact_tenant_isolation_delete", cmd: "DELETE" },
        { policyname: "appointment_contact_tenant_isolation_insert", cmd: "INSERT" },
        { policyname: "appointment_contact_tenant_isolation_select", cmd: "SELECT" },
        { policyname: "appointment_contact_tenant_isolation_update", cmd: "UPDATE" },
      ]);
    });

    it("lets a tenant read its own contact and insert one for its own appointment", async () => {
      const own = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(`SELECT "id" FROM "${TABLE}" WHERE "appointmentId" = $1`, [aContactAppointmentId]));
      expect(own.rows).toEqual([{ id: aContactId }]);
      await expectContactAccepted(
        { tenantId: tenantA.tenantId, asRole: true },
        publicFormRow(tenantA.tenantId, aFreeAppointmentId),
      );
    });

    it("hides Tenant A's contact from Tenant B, with and without a tenantId filter (and reciprocally)", async () => {
      const counts = await inRolledBackTx({ tenantId: tenantB.tenantId, asRole: true }, async (c) => [
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "id" = $1`, [aContactId])).rowCount,
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "tenantId" = $1`, [tenantA.tenantId])).rowCount,
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "appointmentId" = $1`, [aContactAppointmentId])).rowCount,
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "id" = $1`, [bContactId])).rowCount,
      ]);
      expect(counts).toEqual([0, 0, 0, 1]);
      const reverse = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(`SELECT 1 FROM "${TABLE}" WHERE "id" = $1`, [bContactId]));
      expect(reverse.rowCount).toBe(0);
    });

    it("rejects inserting a Tenant A row under Tenant B's context (RLS WITH CHECK)", async () => {
      await expectContactRejected(
        { tenantId: tenantB.tenantId, asRole: true },
        publicFormRow(tenantA.tenantId, aFreeAppointmentId),
        { code: "42501" },
      );
    });

    it("blocks cross-tenant UPDATE and DELETE (0 rows) and leaves Tenant A's row unchanged", async () => {
      const counts = await inRolledBackTx({ tenantId: tenantB.tenantId, asRole: true }, async (c) => [
        (await c.query(`UPDATE "${TABLE}" SET "optOutAt" = ${NOW_UTC} WHERE "id" = $1`, [aContactId])).rowCount,
        (await c.query(`UPDATE "${TABLE}" SET "displayName" = 'Hijacked' WHERE "tenantId" = $1`, [tenantA.tenantId])).rowCount,
        (await c.query(`DELETE FROM "${TABLE}" WHERE "id" = $1`, [aContactId])).rowCount,
        (await c.query(`DELETE FROM "${TABLE}" WHERE "tenantId" = $1`, [tenantA.tenantId])).rowCount,
      ]);
      expect(counts).toEqual([0, 0, 0, 0]);
      await expect(contactRow(aContactId)).resolves.toEqual({
        tenantId: tenantA.tenantId, displayName: "Ayşe Yılmaz", notOptedOut: true,
      });
    });

    it("rejects moving a contact to another tenant under the owner's context (WITH CHECK)", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: true },
        `UPDATE "${TABLE}" SET "tenantId" = $1 WHERE "id" = $2`,
        [tenantB.tenantId, aContactId],
        { code: "42501" },
      );
    });

    it("returns no rows, writes nothing and rejects inserts without a tenant context", async () => {
      const counts = await inRolledBackTx({ tenantId: null, asRole: true }, async (c) => [
        (await c.query(`SELECT 1 FROM "${TABLE}" WHERE "id" IN ($1, $2)`, [aContactId, bContactId])).rowCount,
        (await c.query(`UPDATE "${TABLE}" SET "optOutAt" = ${NOW_UTC} WHERE "id" IN ($1, $2)`, [aContactId, bContactId])).rowCount,
        (await c.query(`DELETE FROM "${TABLE}" WHERE "id" IN ($1, $2)`, [aContactId, bContactId])).rowCount,
      ]);
      expect(counts).toEqual([0, 0, 0]);
      await expectContactRejected(
        { tenantId: null, asRole: true },
        publicFormRow(tenantA.tenantId, aFreeAppointmentId),
        { code: "42501" },
      );
      await expect(contactRow(bContactId)).resolves.toMatchObject({ tenantId: tenantB.tenantId, notOptedOut: true });
    });
  });

  describe("foreign keys and uniqueness", () => {
    const owner = (): Ctx => ({ tenantId: tenantA.tenantId, asRole: false });

    it("rejects a contact pointing at another tenant's appointment (composite FK)", async () => {
      await expectContactRejected(owner(), publicFormRow(tenantA.tenantId, bContactAppointmentId), {
        code: "23503", constraint: "AppointmentContact_tenantId_appointmentId_fkey",
      });
    });

    it("rejects a verbal opt-in recorded by another tenant's profile (composite FK)", async () => {
      await expectContactRejected(
        owner(),
        staffRow(tenantA.tenantId, aFreeAppointmentId, { ...OPT_IN_FIELDS, optInRecordedByProfileId: tenantB.staffProfileId }),
        { code: "23503", constraint: "AppointmentContact_tenantId_optInRecordedByProfileId_fkey" },
      );
    });

    it("rejects a second contact for the same appointment", async () => {
      await expectContactRejected(owner(), publicFormRow(tenantA.tenantId, aContactAppointmentId), {
        code: "23505", constraint: "AppointmentContact_tenantId_appointmentId_key",
      });
    });

    it("restricts deleting an appointment that still has a contact", async () => {
      await expectPgError(owner(), 'DELETE FROM "Appointment" WHERE "id" = $1', [aContactAppointmentId], {
        code: "23503", constraint: "AppointmentContact_tenantId_appointmentId_fkey",
      });
    });
  });

  describe("AppointmentContact CHECKs", () => {
    const owner = (): Ctx => ({ tenantId: tenantA.tenantId, asRole: false });
    const pub = (overrides: ContactRow) => publicFormRow(tenantA.tenantId, aFreeAppointmentId, overrides);
    const staff = (overrides: ContactRow) => staffRow(tenantA.tenantId, aFreeAppointmentId, overrides);

    it.each<[string, () => ContactRow]>([
      ["PUBLIC_FORM with notice, no opt-in", () => pub({})],
      ["PUBLIC_FORM with opt-in", () => pub(OPT_IN_FIELDS)],
      ["PUBLIC_FORM with opt-in then opt-out", () => pub({ ...OPT_IN_FIELDS, optOutAt: T_OPTIN })],
      ["STAFF without notice and without opt-in", () => staff({ email: null })],
      ["STAFF verbal opt-in with recorder", () => staff({ ...OPT_IN_FIELDS, optInRecordedByProfileId: tenantA.staffProfileId })],
      ["STAFF with a shown notice", () => staff({ noticeVersion: "2026-11-draft", noticeHash: HASH_NOTICE, noticeShownAt: T_NOTICE })],
    ])("accepts a valid row: %s (under the tenant role)", async (_label, build) => {
      await expectContactAccepted({ tenantId: tenantA.tenantId, asRole: true }, build());
    });

    it.each<[string, () => ContactRow, string]>([
      ["phone without '+'", () => pub({ phone: "905551112233" }), "AppointmentContact_phone_e164_check"],
      ["phone with leading-zero country code", () => pub({ phone: "+05551112233" }), "AppointmentContact_phone_e164_check"],
      ["phone with a space", () => pub({ phone: "+90 5551112233" }), "AppointmentContact_phone_e164_check"],
      ["phone too long (16 digits)", () => pub({ phone: `+1${"2".repeat(15)}` }), "AppointmentContact_phone_e164_check"],
      ["uppercase noticeHash", () => pub({ noticeHash: "A".repeat(64) }), "AppointmentContact_noticeHash_sha256_hex_check"],
      ["63-char optInHash", () => pub({ ...OPT_IN_FIELDS, optInHash: "b".repeat(63) }), "AppointmentContact_optInHash_sha256_hex_check"],
      ["tab-only displayName", () => pub({ displayName: "\t" }), "AppointmentContact_displayName_not_blank_check"],
      ["email without '@'", () => pub({ email: "ayse.example.test" }), "AppointmentContact_email_format_check"],
      ["email with whitespace", () => pub({ email: "ay se@example.test" }), "AppointmentContact_email_format_check"],
      ["blank noticeVersion", () => pub({ noticeVersion: "  " }), "AppointmentContact_noticeVersion_trimmed_check"],
      ["optInVersion with trailing tab", () => pub({ ...OPT_IN_FIELDS, optInVersion: "v1\t" }), "AppointmentContact_optInVersion_trimmed_check"],
      ["PUBLIC_FORM without noticeHash", () => pub({ noticeHash: null }), "AppointmentContact_public_form_notice_check"],
      ["PUBLIC_FORM without noticeVersion", () => pub({ noticeVersion: null }), "AppointmentContact_public_form_notice_check"],
      ["PUBLIC_FORM without noticeShownAt", () => pub({ noticeShownAt: null }), "AppointmentContact_public_form_notice_check"],
      [
        "PUBLIC_FORM with a staff recorder",
        () => pub({ ...OPT_IN_FIELDS, optInRecordedByProfileId: tenantA.staffProfileId }),
        "AppointmentContact_public_form_notice_check",
      ],
      ["opt-in without phone", () => pub({ ...OPT_IN_FIELDS, phone: null }), "AppointmentContact_optin_requires_record_check"],
      ["opt-in without optInHash", () => pub({ ...OPT_IN_FIELDS, optInHash: null }), "AppointmentContact_optin_requires_record_check"],
      ["opt-in without optInAt", () => pub({ ...OPT_IN_FIELDS, optInAt: null }), "AppointmentContact_optin_requires_record_check"],
      ["STAFF opt-in without recorder", () => staff(OPT_IN_FIELDS), "AppointmentContact_staff_optin_recorder_check"],
      ["opt-out without opt-in", () => pub({ optOutAt: T_OPTIN }), "AppointmentContact_no_optin_fields_without_optin_check"],
      [
        "opt-in text recorded without opt-in",
        () => pub({ optInVersion: "2026-11-draft", optInHash: HASH_OPTIN, optInAt: T_OPTIN }),
        "AppointmentContact_no_optin_fields_without_optin_check",
      ],
      [
        "recorder without opt-in",
        () => staff({ optInRecordedByProfileId: tenantA.staffProfileId }),
        "AppointmentContact_no_optin_fields_without_optin_check",
      ],
      ["opt-out before opt-in", () => pub({ ...OPT_IN_FIELDS, optOutAt: T_BEFORE_OPTIN }), "AppointmentContact_optout_after_optin_check"],
    ])("rejects %s (CHECK)", async (_label, build, constraint) => {
      await expectContactRejected(owner(), build(), { code: "23514", constraint });
    });

    it("rejects a displayName over 160 characters (VARCHAR cap)", async () => {
      await expectContactRejected(owner(), pub({ displayName: "x".repeat(161) }), { code: "22001" });
    });

    it("rejects revoking opt-in on an existing row without clearing its record (UPDATE path)", async () => {
      await expectPgError(
        { tenantId: tenantA.tenantId, asRole: true },
        `UPDATE "${TABLE}" SET "whatsappOptIn" = false WHERE "id" = $1`,
        [aContactId],
        { code: "23514", constraint: "AppointmentContact_no_optin_fields_without_optin_check" },
      );
    });

    it("allows opting out an existing row by setting optOutAt (UPDATE path)", async () => {
      const updated = await inRolledBackTx({ tenantId: tenantA.tenantId, asRole: true }, (c) =>
        c.query(`UPDATE "${TABLE}" SET "optOutAt" = "optInAt" + interval '1 day' WHERE "id" = $1`, [aContactId]));
      expect(updated.rowCount).toBe(1);
    });
  });

  describe("Tenant KVKK legal-field CHECKs", () => {
    const owner = (): Ctx => ({ tenantId: null, asRole: false });
    const setLegal = (column: "legalName" | "legalAddress" | "kvkkContactEmail") =>
      `UPDATE "Tenant" SET "${column}" = $1 WHERE "id" = $2`;

    it("accepts trimmed values (internal newlines allowed in the address) and NULL", async () => {
      const updated = await inRolledBackTx(owner(), (c) =>
        c.query(
          `UPDATE "Tenant" SET "legalName" = $1, "legalAddress" = $2, "kvkkContactEmail" = $3 WHERE "id" = $4`,
          ["Örnek Güzellik Ltd. Şti.", "Atatürk Cad. No:1\nKadıköy / İstanbul", "kvkk@example.test", tenantA.tenantId],
        ));
      expect(updated.rowCount).toBe(1);
      const cleared = await inRolledBackTx(owner(), (c) =>
        c.query(`UPDATE "Tenant" SET "legalName" = NULL, "legalAddress" = NULL, "kvkkContactEmail" = NULL WHERE "id" = $1`, [tenantA.tenantId]));
      expect(cleared.rowCount).toBe(1);
    });

    it.each<["legalName" | "legalAddress", string, string]>([
      ["legalName", "empty", ""],
      ["legalName", "spaces only", "   "],
      ["legalName", "tab only", "\t"],
      ["legalName", "leading space", " Örnek Ltd."],
      ["legalName", "trailing tab", "Örnek Ltd.\t"],
      ["legalAddress", "tab only", "\t\t"],
      ["legalAddress", "newline only", "\n"],
      ["legalAddress", "trailing newline", "Kadıköy\n"],
    ])("rejects %s that is %s (CHECK)", async (column, _label, value) => {
      await expectPgError(owner(), setLegal(column), [value, tenantA.tenantId], {
        code: "23514", constraint: `Tenant_${column}_trimmed_check`,
      });
    });

    it.each([
      ["no '@'", "kvkk.example.test"],
      ["two '@'", "kvkk@@example.test"],
      ["whitespace", "kvkk @example.test"],
      ["tab only", "\t"],
      ["empty", ""],
      ["missing local part", "@example.test"],
    ])("rejects a kvkkContactEmail with %s (CHECK)", async (_label, value) => {
      await expectPgError(owner(), setLegal("kvkkContactEmail"), [value, tenantA.tenantId], {
        code: "23514", constraint: "Tenant_kvkkContactEmail_format_check",
      });
    });

    it.each<["legalName" | "legalAddress", number]>([
      ["legalName", 201],
      ["legalAddress", 501],
    ])("rejects %s longer than its VARCHAR cap", async (column, length) => {
      await expectPgError(owner(), setLegal(column), ["x".repeat(length), tenantA.tenantId], { code: "22001" });
    });
  });
});
