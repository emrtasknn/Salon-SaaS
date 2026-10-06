"use server";
import { createCalendarCrm } from "../../../application/calendar-crm";
import { createAuthenticatedIdentity } from "../../../domain/auth-identity";
import { createPrismaCalendarCrmRepository } from "../../../persistence/prisma-calendar-crm";
import { createPrismaMembershipReader } from "../../../persistence/prisma-membership-reader";
import { createNextSupabaseServerClient } from "../../../infrastructure/auth/supabase-server-client";
import { createSupabaseAuthAdapter } from "../../../infrastructure/auth/supabase-auth-adapter";
import { readSupabaseServerClientConfig } from "../../../infrastructure/auth/supabase-server-env";
import { readAuthenticatedTenantRequest } from "../../../application/auth-request-boundary";
import { getPrisma } from "../../../infrastructure/prisma-runtime";
async function context(){const supabase=await createNextSupabaseServerClient(readSupabaseServerClientConfig());const req=await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({client:supabase as never}));if(req.state!=="authenticated")return null;const prisma=getPrisma();const reader=createPrismaMembershipReader({prisma});const m=await reader.readMembership({tenantContext:req.tenantContext,identity:req.identity});if(m.status!=="found"||!['TENANT_ADMIN','SUPER_ADMIN'].includes(m.membership.role))return null;return{prisma,reader,tenantContext:req.tenantContext,identity:createAuthenticatedIdentity(req.identity.subjectId,m.membership.profileId)}}
function crm(c:NonNullable<Awaited<ReturnType<typeof context>>>) {return createCalendarCrm({repository:createPrismaCalendarCrmRepository(c.prisma),authorizer:{async authorize(identity,tenantContext,role){const m=await c.reader.readMembership({tenantContext,identity});return m.status==='found'&&(m.membership.role==='TENANT_ADMIN'||m.membership.role==='SUPER_ADMIN')&&role==='TENANT_ADMIN'}}})}
export async function getCustomer(id:string){const c=await context();if(!c)return{status:'UNAUTHORIZED' as const};return crm(c).customer(c.identity,c.tenantContext,id)}
export async function addCustomerNote(id:string,body:string){const c=await context();if(!c)return{status:'UNAUTHORIZED' as const};return crm(c).addNote(c.identity,c.tenantContext,id,body)}
