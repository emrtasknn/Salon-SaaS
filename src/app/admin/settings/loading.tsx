import { House } from "lucide-react";
import { SkeletonList, SkeletonScreen } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen title="Ayarlar" breadcrumb={[{ label: "Yönetim", href: "/admin", icon: House }, { label: "Ayarlar" }]}>
      <SkeletonList rows={4} lines={1} />
    </SkeletonScreen>
  );
}
