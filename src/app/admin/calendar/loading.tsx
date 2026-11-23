import { Bone, SkeletonCalendarToolbar, SkeletonScreen } from "../../_ui/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen title="Randevu takvimi" eyebrow accessory widthClassName="max-w-5xl" toolbar={<SkeletonCalendarToolbar />}>
      <div className="flex gap-2">
        <Bone className="h-11 w-36 rounded-control" />
        <Bone className="h-11 w-32 rounded-control" />
      </div>
      <Bone className="h-[28rem] w-full rounded-card" />
    </SkeletonScreen>
  );
}
