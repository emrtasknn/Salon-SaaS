import { Bone, SkeletonList, SkeletonScreen } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen title="Müşteriler" eyebrow widthClassName="max-w-5xl">
      <Bone className="h-12 w-full rounded-control" />
      <SkeletonList rows={6} label={false} />
    </SkeletonScreen>
  );
}
