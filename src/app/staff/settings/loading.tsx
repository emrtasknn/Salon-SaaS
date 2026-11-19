import { CalendarDays } from "lucide-react";
import { SkeletonList, SkeletonScreen } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen title="Ayarlar" breadcrumb={[{ label: "Takvim", href: "/staff", icon: CalendarDays }, { label: "Ayarlar" }]}>
      <SkeletonList rows={4} lines={1} label={false} />
    </SkeletonScreen>
  );
}
