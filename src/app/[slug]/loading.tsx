import { PublicSkeleton } from "../_ui/public-skeleton";
import { SkeletonCard, SkeletonList } from "../_ui/skeleton";

export default function Loading() {
  return (
    <PublicSkeleton>
      <SkeletonCard className="h-16" />
      <SkeletonList rows={4} trailing />
    </PublicSkeleton>
  );
}
