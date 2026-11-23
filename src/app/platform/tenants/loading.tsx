import { Bone, SkeletonList, SkeletonScreen } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen title="İşletmeler" eyebrow widthClassName="max-w-3xl">
      <Bone className="h-12 w-full rounded-control" />
      <SkeletonList rows={5} label={false} trailing />
      <SkeletonList rows={2} lines={1} />
    </SkeletonScreen>
  );
}
