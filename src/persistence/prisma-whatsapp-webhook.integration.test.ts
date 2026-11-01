import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { createTenantId } from "../domain/tenant-context";
import { applyWhatsAppWebhookStatuses, resolveWhatsAppTenantId } from "./prisma-whatsapp-webhook";

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
          AND pg_get_function_identity_arguments(p.oid) = 'p_phone_number_id text'`,
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

    await applyWhatsAppWebhookStatuses(
      prisma as never,
      tenantContext(resolvedTenant!),
      [{ providerMessageId: sharedProviderMessageId, status: "delivered" }],
    );

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
