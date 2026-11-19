import { House } from "lucide-react";
import { SkeletonList, SkeletonScreen } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen title="Personel" breadcrumb={[{ label: "Yönetim", href: "/admin", icon: House }, { label: "Personel" }]}>
      <SkeletonList rows={4} lines={2} />
    </SkeletonScreen>
  );
}
