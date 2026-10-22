import type { CalendarRepository } from "../application/calendar-crm";
import type { AppointmentRecord } from "../domain/appointment";
import type {
  PrismaTenantClient,
  PrismaTenantTransactionClient,
} from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";

type CalendarAppointmentRecord = AppointmentRecord & {
  staff: {
    profile: {
      displayName: string;
    };
  };
  customerProfile: {
    displayName: string;
  };
  service: {
    name: string;
  };
};

type CalendarAppointmentResult = AppointmentRecord & {
  staffDisplayName: string;
  customerDisplayName: string;
  serviceName: string;
};

type Tx = PrismaTenantTransactionClient & {
  appointment: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      include?: {
        staff?: {
          include: {
            profile: {
              select: { displayName: true };
            };
          };
        };
        customerProfile?: {
          select: { displayName: true };
        };
        service?: {
          select: { name: true };
        };
      };
    }): Promise<Array<AppointmentRecord | CalendarAppointmentRecord>>;
  };
  profile: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      take: number;
    }): Promise<
      Array<{
        id: string;
        displayName: string;
        email: string | null;
        phone: string | null;
      }>
    >;
    findUnique(args: {
      where: {
        tenantId_id: {
          tenantId: string;
          id: string;
        };
      };
    }): Promise<{
      id: string;
      displayName: string;
      email: string | null;
      phone: string | null;
    } | null>;
  };
  customerNote: {
    findMany(args: {
      where: { tenantId: string; customerProfileId: string };
      orderBy: { createdAt: "desc" };
    }): Promise<Array<{ id: string; body: string; createdAt: Date }>>;
    create(args: {
      data: {
        tenantId: string;
        customerProfileId: string;
        body: string;
      };
    }): Promise<{ id: string }>;
  };
};

export function createPrismaCalendarCrmRepository(
  prisma: PrismaTenantClient,
): CalendarRepository {
  return {
    async listCustomers(tenantContext, query) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const normalized = query.trim();

        const profiles = await tx.profile.findMany({
          where: {
            tenantId: tenantContext.tenantId,
            ...(normalized
              ? {
                  OR: [
                    {
                      displayName: {
                        contains: normalized,
                        mode: "insensitive",
                      },
                    },
                    {
                      email: {
                        contains: normalized,
                        mode: "insensitive",
                      },
                    },
                    {
                      phone: {
                        contains: normalized,
                        mode: "insensitive",
                      },
                    },
                  ],
                }
              : {}),
          },
          orderBy: { displayName: "asc" },
          take: 100,
        });

        const ids = profiles.map((profile) => profile.id);
        if (!ids.length) return [];

        const appointments = await tx.appointment.findMany({
          where: {
            tenantId: tenantContext.tenantId,
            customerProfileId: { in: ids },
          },
          orderBy: { startAt: "desc" },
        });

        return profiles.map((profile) => {
          const history = appointments.filter(
            (appointment) => appointment.customerProfileId === profile.id,
          );

          return {
            id: profile.id,
            displayName: profile.displayName,
            email: profile.email,
            phone: profile.phone,
            appointmentCount: history.length,
            lastAppointmentAt: history[0]?.startAt ?? null,
          };
        });
      });
    },

    async listAppointments(tenantContext, range) {
      return withPrismaTenantContext(
        prisma,
        tenantContext,
        async (tx: Tx): Promise<CalendarAppointmentResult[]> => {
          const appointments = await tx.appointment.findMany({
            where: {
              tenantId: tenantContext.tenantId,
              startAt: { lt: range.endAt },
              endAt: { gt: range.startAt },
              ...(range.staffId ? { staffId: range.staffId } : {}),
            },
            orderBy: { startAt: "asc" },
            include: {
              staff: {
                include: {
                  profile: {
                    select: { displayName: true },
                  },
                },
              },
              customerProfile: {
                select: { displayName: true },
              },
              service: {
                select: { name: true },
              },
            },
          });

          return appointments.map((appointment) => {
            if (
              !("staff" in appointment) ||
              !("customerProfile" in appointment) ||
              !("service" in appointment)
            ) {
              throw new Error("Calendar appointment relations were not loaded");
            }

            const related = appointment as CalendarAppointmentRecord;

            return {
              id: related.id,
              tenantId: related.tenantId,
              staffId: related.staffId,
              serviceId: related.serviceId,
              customerProfileId: related.customerProfileId,
              startAt: related.startAt,
              endAt: related.endAt,
              status: related.status,
              staffDisplayName: related.staff.profile.displayName,
              customerDisplayName: related.customerProfile.displayName,
              serviceName: related.service.name,
            };
          });
        },
      );
    },

    async customerCard(tenantContext, customerProfileId) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const profile = await tx.profile.findUnique({
          where: {
            tenantId_id: {
              tenantId: tenantContext.tenantId,
              id: customerProfileId,
            },
          },
        });

        if (!profile) return null;

        const [appointments, notes] = await Promise.all([
          tx.appointment.findMany({
            where: {
              tenantId: tenantContext.tenantId,
              customerProfileId,
            },
            orderBy: { startAt: "desc" },
          }),
          tx.customerNote.findMany({
            where: {
              tenantId: tenantContext.tenantId,
              customerProfileId,
            },
            orderBy: { createdAt: "desc" },
          }),
        ]);

        return { ...profile, appointments, notes };
      });
    },

    async addCustomerNote(tenantContext, customerProfileId, body) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const profile = await tx.profile.findUnique({
          where: {
            tenantId_id: {
              tenantId: tenantContext.tenantId,
              id: customerProfileId,
            },
          },
        });

        if (!profile) return "not_found" as const;

        await tx.customerNote.create({
          data: {
            tenantId: tenantContext.tenantId,
            customerProfileId,
            body,
          },
        });

        return "created" as const;
      });
    },
  };
}
