export const dynamic = "force-dynamic";
import { PublicBookingForm } from "./form";
export default async function BookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ service?: string }> }) { const [{slug},q]=await Promise.all([params,searchParams]); return <PublicBookingForm slug={slug} initialServiceId={q.service??""}/>; }
