import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createTenantId } from "../domain/tenant-context";
import {
  applyWhatsAppWebhookStatuses,
  resolveWhatsAppDeliveryTenantId,
  resolveWhatsAppTenantId,
} from "./prisma-whatsapp-webhook";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("WhatsApp webhook PostgreSQL integration", () => {
  const suffix = randomUUID();
  const sharedProviderMessageId = `wamid.shared-${suffix}`;
  const tenantA = `webhook-tenant-a-${suffix}`;
  const tenantB = `webhook-tenant-b-${suffix}`;
  const phoneA = `webhook-phone-active-${suffix}`;
  const phoneB = `webhook-phone-inactive-${suffix}`;

  const fixtures = [
    {
      tenantId: tenantA,
      slug: `webhook-a-${suffix}`,
      profileId: `webhook-customer-a-${suffix}`,
      staffProfileId: `webhook-staff-profile-a-${suffix}`,
      staffId: `webhook-staff-a-${suffix}`,
      serviceId: `webhook-service-a-${suffix}`,
      appointmentId: `webhook-appointment-a-${suffix}`,
      deliveryId: `webhook-delivery-a-${suffix}`,
    },
    {
      tenantId: tenantB,
      slug: `webhook-b-${suffix}`,
      profileId: `webhook-customer-b-${suffix}`,
      staffProfileId: `webhook-staff-profile-b-${suffix}`,
      staffId: `webhook-staff-b-${suffix}`,
      serviceId: `webhook-service-b-${suffix}`,
      appointmentId: `webhook-appointment-b-${suffix}`,
      deliveryId: `webhook-delivery-b-${suffix}`,
    },
  ] as const;

  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;

  const tenantContext = (value: string) => {
    const result = createTenantId(value);
    if (!result.ok) throw new Error("Synthetic tenant ID is invalid");
    return { tenantId: result.value };
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    for (const fixture of fixtures) {
      await pool.query(
        `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
         VALUES ($1, $2, 'Synthetic Webhook Tenant', 'Europe/Istanbul', now(), now())`,
        [fixture.tenantId, fixture.slug],
      );
      await pool.query(
        `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
         VALUES ($1, $2, 'Synthetic Customer', now(), now()),
                ($3, $2, 'Synthetic Staff', now(), now())`,
        [fixture.profileId, fixture.tenantId, fixture.staffProfileId],
      );
      await pool.query(
        `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
        [fixture.staffId, fixture.tenantId, fixture.staffProfileId],
      );
      await pool.query(
        `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
         VALUES ($1, $2, 'Synthetic Service', 30, 0, true, now(), now())`,
        [fixture.serviceId, fixture.tenantId],
      );
      await pool.query(
        `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'PENDING', now() + interval '1 day',
                 now() + interval '1 day 30 minutes', now(), now())`,
        [fixture.appointmentId, fixture.tenantId, fixture.staffId, fixture.serviceId, fixture.profileId],
      );
      await pool.query(
        `INSERT INTO "NotificationDelivery"
          ("id", "tenantId", "appointmentId", "eventType", "channel", "recipientProfileId",
           "templateKey", "status", "providerMessageId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'APPOINTMENT_CREATED', 'WHATSAPP', $4,
                 'synthetic-webhook-test', 'PENDING', $5, now(), now())`,
        [fixture.deliveryId, fixture.tenantId, fixture.appointmentId, fixture.profileId, sharedProviderMessageId],
      );
    }

    await pool.query(
      `INSERT INTO "WhatsAppIntegration"
        ("id", "tenantId", "provider", "phoneNumberId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'META_WHATSAPP', $3, 'ACTIVE', now(), now()),
              ($4, $5, 'META_WHATSAPP', $6, 'INACTIVE', now(), now())`,
      [`webhook-integration-a-${suffix}`, tenantA, phoneA,
       `webhook-integration-b-${suffix}`, tenantB, phoneB],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const errors: string[] = [];
    try {
      for (const fixture of fixtures) {
        await pool.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "WhatsAppIntegration" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "Service" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
      }
    } catch (error) {
      errors.push(`Synthetic webhook fixture cleanup failed: ${String(error)}`);
    }
    try {
      await prisma?.$disconnect();
    } catch (error) {
      errors.push(`Prisma disconnect failed: ${String(error)}`);
    }
    try {
      await pool.end();
    } catch (error) {
      errors.push(`PostgreSQL pool shutdown failed: ${String(error)}`);
    }
    if (errors.length) throw new Error(errors.join("\n"));
  });

  it("resolves only active Meta phone-number integrations", async () => {
    if (!prisma) throw new Error("Prisma client was not initialized");
    await expect(resolveWhatsAppTenantId(prisma as never, phoneA)).resolves.toBe(tenantA);
    await expect(resolveWhatsAppTenantId(prisma as never, phoneB)).resolves.toBeNull();
    await expect(resolveWhatsAppTenantId(prisma as never, `unknown-${suffix}`)).resolves.toBeNull();
  });

  it("keeps resolver privileges narrow and RLS forced on routing and delivery tables", async () => {
    if (!pool) throw new Error("PostgreSQL pool was not initialized");
    const functionResult = await pool.query(
      `SELECT p.prosecdef AS security_definer,
              p.proconfig AS function_config,
              EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS privilege
                WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
              ) AS public_execute
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private'
          AND p.proname = 'resolve_whatsapp_tenant_id'
          AND pg_get_function_arguments(p.oid) = 'p_phone_number_id text'`,
    );
    expect(functionResult.rows).toHaveLength(1);
    expect(functionResult.rows[0]?.security_definer).toBe(true);
    expect(functionResult.rows[0]?.function_config).toContain('search_path=""');
    expect(functionResult.rows[0]?.public_execute).toBe(false);

    const rlsResult = await pool.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('WhatsAppIntegration', 'NotificationDelivery')
        ORDER BY c.relname`,
    );
    expect(rlsResult.rows).toEqual([
      { relname: "NotificationDelivery", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "WhatsAppIntegration", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it("updates only the resolved tenant even when provider message IDs collide across tenants", async () => {
    if (!prisma || !pool) throw new Error("Database clients were not initialized");
    const resolvedTenant = await resolveWhatsAppTenantId(prisma as never, phoneA);
    expect(resolvedTenant).toBe(tenantA);

    const context = tenantContext(resolvedTenant!);
    await applyWhatsAppWebhookStatuses(
      prisma as never,
      context,
      [{ providerMessageId: sharedProviderMessageId, status: "delivered" }],
    );

    await expect(
      applyWhatsAppWebhookStatuses(prisma as never, context, [
        { providerMessageId: sharedProviderMessageId, status: "delivered" },
      ]),
    ).resolves.toBe(0);
    await expect(
      applyWhatsAppWebhookStatuses(prisma as never, context, [
        { providerMessageId: `wamid.unknown-${suffix}`, status: "delivered" },
      ]),
    ).resolves.toBe(0);

    const rows = await pool.query(
      `SELECT "tenantId", "status"
         FROM "NotificationDelivery"
        WHERE "id" IN ($1, $2)
        ORDER BY "tenantId"`,
      [fixtures[0].deliveryId, fixtures[1].deliveryId],
    );
    expect(rows.rows).toEqual([
      { tenantId: tenantA, status: "DELIVERED" },
      { tenantId: tenantB, status: "PENDING" },
    ]);
  });

  it("does not regress DELIVERED on delayed sent/failed events and treats read as a no-op", async () => {
    if (!prisma || !pool) throw new Error("Database clients were not initialized");
    const context = tenantContext(tenantA);

    await applyWhatsAppWebhookStatuses(prisma as never, context, [
      { providerMessageId: sharedProviderMessageId, status: "sent" },
      { providerMessageId: sharedProviderMessageId, status: "failed", errorCode: "131026" },
      { providerMessageId: sharedProviderMessageId, status: "read" },
    ]);

    const result = await pool.query(
      'SELECT "status", "lastErrorCode" FROM "NotificationDelivery" WHERE "id" = $1',
      [fixtures[0].deliveryId],
    );
    expect(result.rows).toEqual([{ status: "DELIVERED", lastErrorCode: null }]);
  });
});

// WP-02c (docs/tasks/WP-02c.md, "Test plan → Integration" 1–8): shared-sender
// status routing by wamid via private.resolve_whatsapp_delivery_tenant_id.
//
// CI connects as a superuser, which skips RLS. Every tenant-scoped UPDATE and
// every cross-tenant read below therefore runs as a temporary NOLOGIN role
// without BYPASSRLS. The role is never granted to the connecting user (nor the
// reverse): a superuser can SET ROLE without membership, and membership grants
// can collide with other suites into a circular-membership error (0LP01, #137).
describeDatabase("WhatsApp shared-sender delivery routing (WP-02c) PostgreSQL integration", () => {
  type DeliveryStatus = "SENT" | "UNKNOWN";
  type EventType = "APPOINTMENT_CREATED" | "APPOINTMENT_CONFIRMED" | "APPOINTMENT_REJECTED";
  type WebhookStatus = {
    providerMessageId: string;
    status: "sent" | "delivered" | "failed" | "read";
    errorCode?: string;
  };

  const suffix = randomUUID();
  const rlsRole = `wp02c_rls_runner_${suffix.replaceAll("-", "")}`;
  const tenantA = `wp02c-tenant-a-${suffix}`;
  const tenantB = `wp02c-tenant-b-${suffix}`;
  const integrationPhoneA = `wp02c-phone-a-${suffix}`;
  const integrationPhoneB = `wp02c-phone-b-${suffix}`;

  // Realistic, distinct Meta message ids (wamid.HBg… shape), not mock-N.
  const makeWamid = () =>
    `wamid.HBgMOTA1MzIxMjM0NTY3FQIAERgS${randomBytes(9).toString("hex").toUpperCase()}00`;
  const padWamid = (length: number) => {
    const base = makeWamid();
    return base + "A".repeat(length - base.length);
  };

  const wamid = {
    onlyA: makeWamid(),
    onlyB: makeWamid(),
    collision: makeWamid(),
    monotonicA: makeWamid(),
    unknownStatusA: makeWamid(),
    integrationA: makeWamid(),
    integrationB: makeWamid(),
    neverStored: makeWamid(),
    oversized: padWamid(257),
    maxLength: padWamid(256),
  };

  const makeTenant = (label: "a" | "b", tenantId: string) => ({
    tenantId,
    slug: `wp02c-${label}-${suffix}`,
    customerProfileId: `wp02c-customer-${label}-${suffix}`,
    staffProfileId: `wp02c-staff-profile-${label}-${suffix}`,
    staffId: `wp02c-staff-${label}-${suffix}`,
    serviceId: `wp02c-service-${label}-${suffix}`,
    appointmentId: `wp02c-appointment-${label}-${suffix}`,
    integrationId: `wp02c-integration-${label}-${suffix}`,
  });
  const fixtureA = makeTenant("a", tenantA);
  const fixtureB = makeTenant("b", tenantB);
  type TenantFixture = typeof fixtureA;

  // (tenantId, appointmentId, eventType, channel, recipientProfileId) is unique,
  // so each row varies eventType and/or recipient.
  const delivery = (
    key: string,
    tenant: TenantFixture,
    eventType: EventType,
    recipient: "customer" | "staff",
    providerMessageId: string,
    status: DeliveryStatus = "SENT",
  ) => ({
    id: `wp02c-delivery-${key}-${suffix}`,
    tenant,
    eventType,
    recipientProfileId: recipient === "customer" ? tenant.customerProfileId : tenant.staffProfileId,
    providerMessageId,
    status,
  });

  const rows = {
    aOnly: delivery("a-only", fixtureA, "APPOINTMENT_CREATED", "customer", wamid.onlyA),
    aCollision: delivery("a-collision", fixtureA, "APPOINTMENT_CONFIRMED", "customer", wamid.collision),
    aMonotonic: delivery("a-monotonic", fixtureA, "APPOINTMENT_REJECTED", "customer", wamid.monotonicA),
    aUnknownStatus: delivery("a-unknown", fixtureA, "APPOINTMENT_CREATED", "staff", wamid.unknownStatusA, "UNKNOWN"),
    aIntegration: delivery("a-integration", fixtureA, "APPOINTMENT_CONFIRMED", "staff", wamid.integrationA),
    aOversized: delivery("a-oversized", fixtureA, "APPOINTMENT_REJECTED", "staff", wamid.oversized),
    bOnly: delivery("b-only", fixtureB, "APPOINTMENT_CREATED", "customer", wamid.onlyB),
    bCollision: delivery("b-collision", fixtureB, "APPOINTMENT_CONFIRMED", "customer", wamid.collision),
    bEmpty: delivery("b-empty", fixtureB, "APPOINTMENT_CREATED", "staff", ""),
    bMaxLength: delivery("b-max-length", fixtureB, "APPOINTMENT_CONFIRMED", "staff", wamid.maxLength),
    bIntegration: delivery("b-integration", fixtureB, "APPOINTMENT_REJECTED", "customer", wamid.integrationB),
  } as const;
  const allDeliveryIds = Object.values(rows).map((row) => row.id);

  /** Superuser client: fixtures, catalog checks, and the resolver call (stand-in for the runtime role). */
  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;
  /** Every session of this pool runs SET ROLE to the non-BYPASSRLS role; used for the tenant-scoped UPDATEs. */
  let rlsPool: Pool | undefined;
  let rlsPrisma: PrismaClient | undefined;
  let rlsSessionError: unknown;
  let roleCreated = false;

  const tenantContext = (value: string) => {
    const result = createTenantId(value);
    if (!result.ok) throw new Error("Synthetic tenant ID is invalid");
    return { tenantId: result.value };
  };

  const requireClients = () => {
    if (!pool || !prisma || !rlsPrisma) throw new Error("Database clients were not initialized");
    return { pool, prisma, rlsPrisma };
  };

  const sqlState = async (promise: Promise<unknown>): Promise<string | null> => {
    try {
      await promise;
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? "no-sqlstate";
    }
  };

  /** Guards against a silent SET ROLE failure turning every RLS assertion into a superuser no-op. */
  const expectRlsBoundSession = async () => {
    const { rlsPrisma: client } = requireClients();
    const session = await client.$queryRaw<Array<{ currentUser: string; superuser: boolean; bypassRls: boolean }>>`
      SELECT current_user::text AS "currentUser", r.rolsuper AS "superuser", r.rolbypassrls AS "bypassRls"
        FROM pg_catalog.pg_roles r
       WHERE r.rolname = current_user
    `;
    expect(rlsSessionError).toBeUndefined();
    expect(session).toEqual([{ currentUser: rlsRole, superuser: false, bypassRls: false }]);
  };

  /** Raw SQL as the RLS-bound role inside a transaction that is always rolled back. */
  const asRlsRole = async <T>(tenantId: string | null, operation: (client: PoolClient) => Promise<T>): Promise<T> => {
    const { pool: superuserPool } = requireClients();
    const client = await superuserPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE "${rlsRole}"`);
      if (tenantId) await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return await operation(client);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("RESET ROLE").catch(() => undefined);
      client.release();
    }
  };

  /** Mirrors the shared-sender branch of src/app/api/webhooks/whatsapp/route.ts. */
  const routeSharedSenderStatuses = async (statuses: readonly WebhookStatus[]) => {
    const clients = requireClients();
    const byTenant = new Map<string, WebhookStatus[]>();
    let unresolved = 0;
    for (const status of statuses) {
      const tenantId = await resolveWhatsAppDeliveryTenantId(clients.prisma as never, status.providerMessageId);
      if (!tenantId) {
        unresolved += 1;
        continue;
      }
      byTenant.set(tenantId, [...(byTenant.get(tenantId) ?? []), status]);
    }
    let updated = 0;
    for (const [tenantId, tenantStatuses] of byTenant) {
      updated += await applyWhatsAppWebhookStatuses(clients.rlsPrisma as never, tenantContext(tenantId), tenantStatuses);
    }
    return { updated, unresolved };
  };

  const deliveryState = async (...ids: string[]) => {
    const { pool: superuserPool } = requireClients();
    const result = await superuserPool.query<{ id: string; status: string; lastErrorCode: string | null }>(
      `SELECT "id", "status"::text AS "status", "lastErrorCode"
         FROM "NotificationDelivery"
        WHERE "id" = ANY($1::text[])`,
      [ids],
    );
    return Object.fromEntries(result.rows.map((row) => [row.id, { status: row.status, lastErrorCode: row.lastErrorCode }]));
  };

  const snapshotAllDeliveries = async () => {
    const { pool: superuserPool } = requireClients();
    const result = await superuserPool.query(
      `SELECT "id", "status"::text AS "status", "lastErrorCode", "updatedAt"
         FROM "NotificationDelivery"
        WHERE "id" = ANY($1::text[])
        ORDER BY "id"`,
      [allDeliveryIds],
    );
    return result.rows;
  };

  const callResolverSql = async (value: string | null) => {
    const { pool: superuserPool } = requireClients();
    const result = await superuserPool.query<{ tenantId: string | null }>(
      'SELECT private.resolve_whatsapp_delivery_tenant_id($1::text) AS "tenantId"',
      [value],
    );
    return result.rows[0]?.tenantId ?? null;
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    await pool.query(`CREATE ROLE "${rlsRole}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);
    roleCreated = true;
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${rlsRole}"`);
    await pool.query(`GRANT SELECT, UPDATE ON "NotificationDelivery" TO "${rlsRole}"`);
    await pool.query(`GRANT SELECT ON "WhatsAppIntegration" TO "${rlsRole}"`);

    // One connection, so the identity checked by expectRlsBoundSession is the
    // one every Prisma transaction runs on.
    rlsPool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000, max: 1 });
    rlsPool.on("connect", (client) => {
      client.query(`SET ROLE "${rlsRole}"`).catch((error: unknown) => {
        rlsSessionError = error;
      });
    });
    rlsPrisma = new PrismaClient({ adapter: new PrismaPg(rlsPool) });

    for (const fixture of [fixtureA, fixtureB]) {
      await pool.query(
        `INSERT INTO "Tenant" ("id", "slug", "name", "timezone", "createdAt", "updatedAt")
         VALUES ($1, $2, 'Synthetic WP-02c Tenant', 'Europe/Istanbul', now(), now())`,
        [fixture.tenantId, fixture.slug],
      );
      await pool.query(
        `INSERT INTO "Profile" ("id", "tenantId", "displayName", "createdAt", "updatedAt")
         VALUES ($1, $2, 'Synthetic Customer', now(), now()),
                ($3, $2, 'Synthetic Staff', now(), now())`,
        [fixture.customerProfileId, fixture.tenantId, fixture.staffProfileId],
      );
      await pool.query(
        `INSERT INTO "Staff" ("id", "tenantId", "profileId", "status", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
        [fixture.staffId, fixture.tenantId, fixture.staffProfileId],
      );
      await pool.query(
        `INSERT INTO "Service" ("id", "tenantId", "name", "durationMinutes", "bufferMinutes", "active", "createdAt", "updatedAt")
         VALUES ($1, $2, 'Synthetic Service', 30, 0, true, now(), now())`,
        [fixture.serviceId, fixture.tenantId],
      );
      await pool.query(
        `INSERT INTO "Appointment" ("id", "tenantId", "staffId", "serviceId", "customerProfileId", "status", "startAt", "endAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'PENDING', now() + interval '1 day',
                 now() + interval '1 day 30 minutes', now(), now())`,
        [fixture.appointmentId, fixture.tenantId, fixture.staffId, fixture.serviceId, fixture.customerProfileId],
      );
    }

    for (const row of Object.values(rows)) {
      await pool.query(
        `INSERT INTO "NotificationDelivery"
          ("id", "tenantId", "appointmentId", "eventType", "channel", "recipientProfileId",
           "templateKey", "status", "providerMessageId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'WHATSAPP', $5,
                 'synthetic-wp02c-test', $6, $7, now(), now())`,
        [row.id, row.tenant.tenantId, row.tenant.appointmentId, row.eventType,
         row.recipientProfileId, row.status, row.providerMessageId],
      );
    }

    await pool.query(
      `INSERT INTO "WhatsAppIntegration"
        ("id", "tenantId", "provider", "phoneNumberId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'META_WHATSAPP', $3, 'ACTIVE', now(), now()),
              ($4, $5, 'META_WHATSAPP', $6, 'ACTIVE', now(), now())`,
      [fixtureA.integrationId, tenantA, integrationPhoneA,
       fixtureB.integrationId, tenantB, integrationPhoneB],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const errors: string[] = [];
    // Close the RLS-bound sessions before dropping the role they run as.
    try {
      await rlsPrisma?.$disconnect();
    } catch (error) {
      errors.push(`RLS Prisma disconnect failed: ${String(error)}`);
    }
    try {
      await rlsPool?.end();
    } catch (error) {
      errors.push(`RLS pool shutdown failed: ${String(error)}`);
    }
    try {
      for (const fixture of [fixtureA, fixtureB]) {
        await pool.query('DELETE FROM "NotificationDelivery" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "WhatsAppIntegration" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "Appointment" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "Staff" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "Service" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "Profile" WHERE "tenantId" = $1', [fixture.tenantId]);
        await pool.query('DELETE FROM "Tenant" WHERE "id" = $1', [fixture.tenantId]);
      }
    } catch (error) {
      errors.push(`Synthetic WP-02c fixture cleanup failed: ${String(error)}`);
    }
    if (roleCreated) {
      try {
        await pool.query(`REASSIGN OWNED BY "${rlsRole}" TO CURRENT_USER`);
        await pool.query(`DROP OWNED BY "${rlsRole}"`);
        await pool.query(`DROP ROLE IF EXISTS "${rlsRole}"`);
      } catch (error) {
        errors.push(`WP-02c test role cleanup failed: ${String(error)}`);
      }
    }
    try {
      await prisma?.$disconnect();
    } catch (error) {
      errors.push(`Prisma disconnect failed: ${String(error)}`);
    }
    try {
      await pool.end();
    } catch (error) {
      errors.push(`PostgreSQL pool shutdown failed: ${String(error)}`);
    }
    if (errors.length) throw new Error(errors.join("\n"));
  });

  it("(1) routes each tenant's wamid on the shared sender to that tenant only, in both directions", async () => {
    await expectRlsBoundSession();

    // RLS itself (not only the UPDATE's tenant filter) stops a tenant-A context
    // from writing B's row; positive control proves the role can write its own.
    const crossTenantWrite = await asRlsRole(tenantA, (client) =>
      client.query(`UPDATE "NotificationDelivery" SET "status" = 'DELIVERED' WHERE "providerMessageId" = $1`, [wamid.onlyB]));
    const ownTenantWrite = await asRlsRole(tenantB, (client) =>
      client.query(`UPDATE "NotificationDelivery" SET "status" = 'DELIVERED' WHERE "providerMessageId" = $1`, [wamid.onlyB]));
    expect(crossTenantWrite.rowCount).toBe(0);
    expect(ownTenantWrite.rowCount).toBe(1);

    await expect(resolveWhatsAppDeliveryTenantId(requireClients().prisma as never, wamid.onlyB)).resolves.toBe(tenantB);
    await expect(resolveWhatsAppDeliveryTenantId(requireClients().prisma as never, wamid.onlyA)).resolves.toBe(tenantA);

    await expect(routeSharedSenderStatuses([{ providerMessageId: wamid.onlyB, status: "delivered" }]))
      .resolves.toEqual({ updated: 1, unresolved: 0 });
    expect(await deliveryState(rows.aOnly.id, rows.bOnly.id)).toEqual({
      [rows.aOnly.id]: { status: "SENT", lastErrorCode: null },
      [rows.bOnly.id]: { status: "DELIVERED", lastErrorCode: null },
    });

    await expect(routeSharedSenderStatuses([{ providerMessageId: wamid.onlyA, status: "delivered" }]))
      .resolves.toEqual({ updated: 1, unresolved: 0 });
    expect(await deliveryState(rows.aOnly.id, rows.bOnly.id)).toEqual({
      [rows.aOnly.id]: { status: "DELIVERED", lastErrorCode: null },
      [rows.bOnly.id]: { status: "DELIVERED", lastErrorCode: null },
    });
  });

  it("(2) fails closed when the same wamid exists in two tenants: NULL, no row changes", async () => {
    await expectRlsBoundSession();
    const before = await snapshotAllDeliveries();

    await expect(callResolverSql(wamid.collision)).resolves.toBeNull();
    await expect(resolveWhatsAppDeliveryTenantId(requireClients().prisma as never, wamid.collision)).resolves.toBeNull();
    await expect(routeSharedSenderStatuses([
      { providerMessageId: wamid.collision, status: "delivered" },
      { providerMessageId: wamid.collision, status: "failed", errorCode: "131026" },
    ])).resolves.toEqual({ updated: 0, unresolved: 2 });

    expect(await snapshotAllDeliveries()).toEqual(before);
    // Each tenant still sees exactly its own, unchanged collision row under RLS.
    for (const [tenantId, rowId] of [[tenantA, rows.aCollision.id], [tenantB, rows.bCollision.id]] as const) {
      const visible = await asRlsRole(tenantId, (client) =>
        client.query(`SELECT "id", "tenantId", "status"::text AS "status" FROM "NotificationDelivery" WHERE "providerMessageId" = $1`, [wamid.collision]));
      expect(visible.rows).toEqual([{ id: rowId, tenantId, status: "SENT" }]);
    }
  });

  it("(3) returns NULL for an unknown wamid and mutates nothing", async () => {
    await expectRlsBoundSession();
    const before = await snapshotAllDeliveries();

    await expect(callResolverSql(wamid.neverStored)).resolves.toBeNull();
    await expect(resolveWhatsAppDeliveryTenantId(requireClients().prisma as never, wamid.neverStored)).resolves.toBeNull();
    await expect(routeSharedSenderStatuses([{ providerMessageId: wamid.neverStored, status: "delivered" }]))
      .resolves.toEqual({ updated: 0, unresolved: 1 });

    expect(await snapshotAllDeliveries()).toEqual(before);
  });

  it("(4) keeps the delivery resolver a narrow SECURITY DEFINER function with a non-unique wamid index", async () => {
    const { pool: superuserPool } = requireClients();
    const fn = await superuserPool.query(
      `SELECT p.prosecdef AS "securityDefiner",
              p.proisstrict AS "strict",
              p.provolatile AS "volatility",
              p.proconfig AS "config",
              p.prorettype = 'pg_catalog.text'::regtype AS "returnsText",
              owner.rolsuper AS "ownerSuperuser",
              owner.rolbypassrls AS "ownerBypassRls",
              EXISTS (
                SELECT 1
                  FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS privilege
                 WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
              ) AS "publicExecute",
              has_function_privilege($1::name, p.oid, 'EXECUTE') AS "testRoleExecute"
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles owner ON owner.oid = p.proowner
        WHERE n.nspname = 'private'
          AND p.proname = 'resolve_whatsapp_delivery_tenant_id'
          AND pg_get_function_arguments(p.oid) = 'p_provider_message_id text'`,
      [rlsRole],
    );
    expect(fn.rows).toHaveLength(1);
    const meta = fn.rows[0];
    expect(meta.securityDefiner).toBe(true);
    expect(meta.strict).toBe(true);
    expect(meta.volatility).toBe("s");
    expect(meta.config).toContain('search_path=""');
    expect(meta.returnsText).toBe(true);
    expect(meta.publicExecute).toBe(false);
    // With FORCE RLS a non-bypass owner would see zero rows and always return NULL.
    expect(meta.ownerSuperuser || meta.ownerBypassRls).toBe(true);
    expect(meta.testRoleExecute).toBe(false);

    // Supabase roles are absent on CI PostgreSQL; when present they must not execute it.
    const supabaseRoles = await superuserPool.query(
      `SELECT r.rolname AS "role", has_function_privilege(r.oid, p.oid, 'EXECUTE') AS "canExecute"
         FROM pg_roles r
        CROSS JOIN pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private'
          AND p.proname = 'resolve_whatsapp_delivery_tenant_id'
          AND r.rolname IN ('anon', 'authenticated', 'service_role')`,
    );
    for (const row of supabaseRoles.rows) expect(row, `role ${String(row.role)}`).toEqual({ role: row.role, canExecute: false });

    // A tenant-scoped, non-bypass role cannot call the pre-tenant resolver at all.
    await expect(asRlsRole(tenantA, (client) => sqlState(
      client.query("SELECT private.resolve_whatsapp_delivery_tenant_id($1::text)", [wamid.onlyA]),
    ))).resolves.toBe("42501");

    const index = await superuserPool.query(
      `SELECT i.indisunique AS "unique", pg_get_indexdef(i.indexrelid) AS "definition"
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'NotificationDelivery_providerMessageId_idx'`,
    );
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0]?.unique).toBe(false);
    expect(index.rows[0]?.definition).toContain('("providerMessageId")');

    const uniqueOnWamid = await superuserPool.query(
      `SELECT count(*)::int AS "count"
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = 'public."NotificationDelivery"'::regclass
          AND i.indisunique
          AND i.indnatts = 1
          AND a.attname = 'providerMessageId'`,
    );
    expect(uniqueOnWamid.rows[0]?.count).toBe(0);
  });

  it("(5) keeps RLS forced; a tenant-A context cannot read B's rows after routing", async () => {
    const { pool: superuserPool, prisma: superuserPrisma } = requireClients();
    const rls = await superuserPool.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('WhatsAppIntegration', 'NotificationDelivery')
        ORDER BY c.relname`,
    );
    expect(rls.rows).toEqual([
      { relname: "NotificationDelivery", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "WhatsAppIntegration", relrowsecurity: true, relforcerowsecurity: true },
    ]);

    await expect(resolveWhatsAppDeliveryTenantId(superuserPrisma as never, wamid.onlyB)).resolves.toBe(tenantB);

    const readB = (client: PoolClient) => Promise.all([
      client.query('SELECT "id" FROM "NotificationDelivery" WHERE "id" = $1', [rows.bOnly.id]),
      client.query('SELECT "id" FROM "NotificationDelivery" WHERE "providerMessageId" = $1', [wamid.onlyB]),
      client.query('SELECT "id" FROM "WhatsAppIntegration" WHERE "id" = $1', [fixtureB.integrationId]),
    ]).then((results) => results.map((result) => result.rowCount));

    await expect(asRlsRole(tenantA, readB)).resolves.toEqual([0, 0, 0]);
    await expect(asRlsRole(null, readB)).resolves.toEqual([0, 0, 0]);
    await expect(asRlsRole(tenantB, readB)).resolves.toEqual([1, 1, 1]);
  });

  it("(6) is monotonic: no regression after DELIVERED; duplicates and read are no-ops; UNKNOWN reconciles", async () => {
    await expectRlsBoundSession();

    await expect(routeSharedSenderStatuses([{ providerMessageId: wamid.monotonicA, status: "delivered" }]))
      .resolves.toEqual({ updated: 1, unresolved: 0 });
    await expect(routeSharedSenderStatuses([
      { providerMessageId: wamid.monotonicA, status: "sent" },
      { providerMessageId: wamid.monotonicA, status: "failed", errorCode: "131026" },
      { providerMessageId: wamid.monotonicA, status: "delivered" },
      { providerMessageId: wamid.monotonicA, status: "read" },
    ])).resolves.toEqual({ updated: 0, unresolved: 0 });

    // Ambiguous send outcome (UNKNOWN) with a stored wamid is still routed and reconciled.
    await expect(routeSharedSenderStatuses([{ providerMessageId: wamid.unknownStatusA, status: "delivered" }]))
      .resolves.toEqual({ updated: 1, unresolved: 0 });

    expect(await deliveryState(rows.aMonotonic.id, rows.aUnknownStatus.id)).toEqual({
      [rows.aMonotonic.id]: { status: "DELIVERED", lastErrorCode: null },
      [rows.aUnknownStatus.id]: { status: "DELIVERED", lastErrorCode: null },
    });
  });

  it("(7) still routes a non-shared number through WhatsAppIntegration (W11.6 regression)", async () => {
    await expectRlsBoundSession();
    const { prisma: superuserPrisma, rlsPrisma: tenantPrisma } = requireClients();

    const resolvedA = await resolveWhatsAppTenantId(superuserPrisma as never, integrationPhoneA);
    const resolvedB = await resolveWhatsAppTenantId(superuserPrisma as never, integrationPhoneB);
    expect(resolvedA).toBe(tenantA);
    expect(resolvedB).toBe(tenantB);

    // A status for B's wamid arriving on A's number cannot touch B.
    await expect(applyWhatsAppWebhookStatuses(tenantPrisma as never, tenantContext(resolvedA!), [
      { providerMessageId: wamid.integrationB, status: "delivered" },
    ])).resolves.toBe(0);
    expect(await deliveryState(rows.bIntegration.id)).toEqual({
      [rows.bIntegration.id]: { status: "SENT", lastErrorCode: null },
    });

    await expect(applyWhatsAppWebhookStatuses(tenantPrisma as never, tenantContext(resolvedA!), [
      { providerMessageId: wamid.integrationA, status: "delivered" },
    ])).resolves.toBe(1);
    await expect(applyWhatsAppWebhookStatuses(tenantPrisma as never, tenantContext(resolvedB!), [
      { providerMessageId: wamid.integrationB, status: "failed", errorCode: "131026" },
    ])).resolves.toBe(1);

    expect(await deliveryState(rows.aIntegration.id, rows.bIntegration.id)).toEqual({
      [rows.aIntegration.id]: { status: "DELIVERED", lastErrorCode: null },
      [rows.bIntegration.id]: { status: "FAILED", lastErrorCode: "131026" },
    });
  });

  it("(8) rejects empty and oversized wamids even when a matching row exists", async () => {
    const { pool: superuserPool, prisma: superuserPrisma } = requireClients();
    // The rows exist, so a NULL below comes from the input guard, not a miss.
    const stored = await superuserPool.query(
      `SELECT "providerMessageId" AS "wamid", "tenantId"
         FROM "NotificationDelivery"
        WHERE "id" = ANY($1::text[])
        ORDER BY "id"`,
      [[rows.bEmpty.id, rows.aOversized.id, rows.bMaxLength.id]],
    );
    expect(stored.rows).toHaveLength(3);
    expect(wamid.oversized).toHaveLength(257);
    expect(wamid.maxLength).toHaveLength(256);

    await expect(callResolverSql("")).resolves.toBeNull();
    await expect(callResolverSql(wamid.oversized)).resolves.toBeNull();
    await expect(callResolverSql(null)).resolves.toBeNull();
    await expect(callResolverSql(wamid.maxLength)).resolves.toBe(tenantB);

    await expect(resolveWhatsAppDeliveryTenantId(superuserPrisma as never, "")).resolves.toBeNull();
    await expect(resolveWhatsAppDeliveryTenantId(superuserPrisma as never, wamid.oversized)).resolves.toBeNull();
    await expect(resolveWhatsAppDeliveryTenantId(superuserPrisma as never, wamid.maxLength)).resolves.toBe(tenantB);
  });
});
