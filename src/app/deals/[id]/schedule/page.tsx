"use client";

import TrackSchedule, { OtherTrackLinks } from "@/components/schedule/TrackSchedule";

export default function AcquisitionSchedulePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-6">
      <OtherTrackLinks dealId={params.id} current="acquisition" />
      <TrackSchedule
        dealId={params.id}
        track="acquisition"
        description="Deal-stage milestones from call-for-offers through close. Each milestone date anchors downstream Development and Construction timelines automatically."
      />
    </div>
  );
}
