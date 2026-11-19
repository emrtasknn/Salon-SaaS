import { Bone, SkeletonList, SkeletonScreen } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen title="Randevularım" eyebrow accessory widthClassName="max-w-4xl" toolbar={<Bone className="h-11 w-56 rounded-control" />}>
      <SkeletonList rows={4} label={false} trailing />
    </SkeletonScreen>
  );
}
