import { Bone, SkeletonScreen } from "../_ui/skeleton";

// Staff home ("Özet") while the server loads it.
export default function Loading() {
  return (
    <SkeletonScreen eyebrow accessory>
      <Bone className="h-24 w-full rounded-card" />
      <div className="grid grid-cols-3 gap-2">
        <Bone className="h-20 rounded-card" />
        <Bone className="h-20 rounded-card" />
        <Bone className="h-20 rounded-card" />
      </div>
      <Bone className="h-48 w-full rounded-card" />
    </SkeletonScreen>
  );
}
