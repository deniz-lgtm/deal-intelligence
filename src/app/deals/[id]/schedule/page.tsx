"use client";

import { OtherTrackLinks } from "@/components/schedule/TrackSchedule";
import DevelopmentSchedule from "@/components/DevelopmentSchedule";

export default function AcquisitionSchedulePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-8">
      <OtherTrackLinks dealId={params.id} current="acquisition" />
      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">Acquisition Schedule</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Deal-stage milestones from call-for-offers through close. Each
            milestone date anchors the downstream Development and Construction
            timelines automatically. For document-completeness tracking, use the
            DD Checklist.
          </p>
        </div>
        <DevelopmentSchedule dealId={params.id} track="acquisition" />
      </div>
    </div>
  );
}
