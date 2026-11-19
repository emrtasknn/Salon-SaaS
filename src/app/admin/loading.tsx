import { SkeletonCard, SkeletonList, SkeletonScreen } from "../_ui/skeleton";

// Admin home while the server loads it: greeting, "Bugün", İşletme and Hesap groups.
export default function Loading() {
  return (
    <SkeletonScreen eyebrow accessory>
      <SkeletonCard />
      <SkeletonList rows={4} lines={1} />
      <SkeletonList rows={2} lines={1} />
    </SkeletonScreen>
  );
}
