-- Archive ("soft") delete support (delete-permissions plan, Task 1): a nullable "deletedAt"
-- timestamp on Tenant, Staff, Service, Profile and Appointment. NULL = live row; set = archived.
-- Read paths filter on it in later tasks; this migration only adds the columns.
-- PROPOSAL — apply only after owner approval, and validate in CI (isolated PostgreSQL 17) first.
-- Ordering: after 20261111100000_appointment_services (latest existing migration at drafting time).
-- Additive only: five nullable columns, all existing rows NULL. No default, no backfill,
-- no index, no CHECK. No RLS change: the existing FOR ALL tenant-isolation policies already
-- scope updates to these columns; Tenant is the root table, intentionally not under RLS.
--
-- Rollback (only after the application no longer reads/writes the columns; archived
-- state is lost by the drop):
--   ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "deletedAt";
--   ALTER TABLE "Staff" DROP COLUMN IF EXISTS "deletedAt";
--   ALTER TABLE "Service" DROP COLUMN IF EXISTS "deletedAt";
--   ALTER TABLE "Profile" DROP COLUMN IF EXISTS "deletedAt";
--   ALTER TABLE "Appointment" DROP COLUMN IF EXISTS "deletedAt";

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Service" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "deletedAt" TIMESTAMP(3);
