import { House } from "lucide-react";
import { SkeletonList, SkeletonScreen } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen title="İşletme bilgileri" breadcrumb={[{ label: "Yönetim", href: "/admin", icon: House }, { label: "İşletme bilgileri" }]}>
      <SkeletonList rows={5} lines={1} />
    </SkeletonScreen>
  );
}
