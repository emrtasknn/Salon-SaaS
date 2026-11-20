// ADR-045: busy time from connected phone calendars, drawn in the calendar grids as grey
// "Dolu" blocks. Display only: they cannot be opened, moved or edited, and never reach an
// appointment action.

export const BUSY_STATUS = "EXTERNAL_BUSY";
const BUSY_PREFIX = "busy:";

/** `title`: the phone event's own title (RandevuN account); null for Google free/busy. */
export type BusyBlock = Readonly<{ id: string; staffId: string; startAt: string; endAt: string; title?: string | null }>;

export function isBusyItemId(id: string): boolean {
  return id.startsWith(BUSY_PREFIX);
}

export function busyItems(blocks: readonly BusyBlock[], rowIdOf: (block: BusyBlock) => string) {
  return blocks.map((block) => ({
    id: `${BUSY_PREFIX}${block.id}`,
    rowId: rowIdOf(block),
    staffId: block.staffId,
    startAt: block.startAt,
    endAt: block.endAt,
    status: BUSY_STATUS,
    customer: block.title ? `Dolu · ${block.title}` : "Dolu",
    service: "Telefon takvimi",
  }));
}
