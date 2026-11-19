import { Bone, SkeletonCalendarToolbar, SkeletonScreen } from "../_ui/skeleton";

// Staff home (own calendar) while the server loads it.
export default function Loading() {
  return (
    <SkeletonScreen eyebrow accessory widthClassName="max-w-5xl" toolbar={<SkeletonCalendarToolbar />}>
      <div className="flex justify-between gap-2">
        <Bone className="h-5 w-48" />
        <Bone className="h-11 w-40 rounded-control" />
      </div>
      <Bone className="h-[28rem] w-full rounded-card" />
    </SkeletonScreen>
  );
}
