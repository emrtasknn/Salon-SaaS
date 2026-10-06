CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED');

ALTER TABLE "Appointment" ADD COLUMN "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING';

CREATE INDEX "Appointment_tenantId_staffId_status_startAt_idx"
  ON "Appointment"("tenantId", "staffId", "status", "startAt");
