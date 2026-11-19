import { Building2 } from "lucide-react";
import { SkeletonList, SkeletonScreen } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen title="Ayarlar" breadcrumb={[{ label: "İşletmeler", href: "/platform/tenants", icon: Building2 }, { label: "Ayarlar" }]}>
      <SkeletonList rows={3} lines={1} label={false} />
    </SkeletonScreen>
  );
}
