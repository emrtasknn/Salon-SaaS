export type ServiceRecord = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  active: boolean;
}>;

export const SERVICE_NAME_MAX_LENGTH = 120;
export const SERVICE_DURATION_MAX_MINUTES = 24 * 60;
export const SERVICE_BUFFER_MAX_MINUTES = 24 * 60;

function isControlFreeText(value: string): boolean {
  return !/[\u0000-\u001f\u007f]/.test(value);
}

export function normalizeServiceName(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Service name is invalid");
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > SERVICE_NAME_MAX_LENGTH || !isControlFreeText(normalized)) {
    throw new TypeError("Service name is invalid");
  }
  return normalized;
}

export function createServiceDurationMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > SERVICE_DURATION_MAX_MINUTES) {
    throw new TypeError("Service duration is invalid");
  }
  return value;
}

export function createServiceBufferMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > SERVICE_BUFFER_MAX_MINUTES) {
    throw new TypeError("Service buffer is invalid");
  }
  return value;
}

export function isServiceBookable(active: boolean): boolean {
  return active;
}

export function createServiceRecord(input: {
  id: string;
  tenantId: string;
  name: unknown;
  durationMinutes: unknown;
  bufferMinutes: unknown;
  active?: unknown;
}): ServiceRecord {
  if (typeof input.id !== "string" || input.id.length === 0) throw new TypeError("Service id is invalid");
  if (typeof input.tenantId !== "string" || input.tenantId.length === 0) throw new TypeError("Service tenant is invalid");
  if (input.active !== undefined && typeof input.active !== "boolean") throw new TypeError("Service active state is invalid");

  return Object.freeze({
    id: input.id,
    tenantId: input.tenantId,
    name: normalizeServiceName(input.name),
    durationMinutes: createServiceDurationMinutes(input.durationMinutes),
    bufferMinutes: createServiceBufferMinutes(input.bufferMinutes),
    active: input.active ?? true,
  });
}
