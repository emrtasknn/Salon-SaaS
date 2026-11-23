import { PublicSkeleton } from "../../_ui/public-skeleton";
import { SkeletonList } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <PublicSkeleton>
      <SkeletonList rows={4} />
    </PublicSkeleton>
  );
}
