"use client";

import TrackSchedule, { OtherTrackLinks } from "@/components/schedule/TrackSchedule";

export default function ConstructionSchedulePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-6">
      <OtherTrackLinks dealId={params.id} current="construction" />
      <TrackSchedule
        dealId={params.id}
        track="construction"
        description="Construction activities from mobilization through certificate of occupancy. Upload a GC schedule PDF to auto-populate activities and dependencies."
      />
    </div>
  );
}
