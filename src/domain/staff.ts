export type StaffStatus = "ACTIVE" | "INACTIVE";

export type StaffRecord = Readonly<{
  id: string;
  tenantId: string;
  profileId: string;
  status: StaffStatus;
}>;

export function isStaffStatus(value: unknown): value is StaffStatus {
  return value === "ACTIVE" || value === "INACTIVE";
}

export function isStaffBookable(status: StaffStatus): boolean {
  return status === "ACTIVE";
}

export function createStaffStatus(value: unknown = "ACTIVE"): StaffStatus {
  if (!isStaffStatus(value)) throw new TypeError("Staff status is invalid");
  return value;
}
