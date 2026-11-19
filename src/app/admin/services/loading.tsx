import { House } from "lucide-react";
import { SkeletonList, SkeletonScreen } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen title="Hizmetler" breadcrumb={[{ label: "Yönetim", href: "/admin", icon: House }, { label: "Hizmetler" }]}>
      <SkeletonList rows={5} lines={2} />
    </SkeletonScreen>
  );
}
