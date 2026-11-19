import { House } from "lucide-react";
import { SkeletonList, SkeletonScreen } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen title="Çalışma saatleri" breadcrumb={[{ label: "Yönetim", href: "/admin", icon: House }, { label: "Çalışma saatleri" }]}>
      <SkeletonList rows={7} lines={1} />
    </SkeletonScreen>
  );
}
