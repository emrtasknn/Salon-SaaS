-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('SUPER_ADMIN', 'TENANT_ADMIN', 'STAFF', 'CUSTOMER');

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_tenantId_id_key" ON "TenantMembership"("tenantId", "id");
CREATE UNIQUE INDEX "TenantMembership_tenantId_subjectId_key" ON "TenantMembership"("tenantId", "subjectId");
CREATE INDEX "TenantMembership_tenantId_profileId_idx" ON "TenantMembership"("tenantId", "profileId");

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_profile_tenant_fkey"
  FOREIGN KEY ("tenantId", "profileId") REFERENCES "Profile"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;