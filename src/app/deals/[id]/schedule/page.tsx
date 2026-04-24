"use client";

import TrackSchedule, { OtherTrackLinks } from "@/components/schedule/TrackSchedule";
import ProjectManagement from "@/components/ProjectManagement";

export default function AcquisitionSchedulePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-8">
      <OtherTrackLinks dealId={params.id} current="acquisition" />
      <TrackSchedule
        dealId={params.id}
        track="acquisition"
        description="Deal-stage milestones from call-for-offers through close. Each milestone date anchors downstream Development and Construction timelines automatically."
      />

      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">Deal Milestones &amp; Tasks</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Stage-anchored milestones (Site visit, OM reviewed, LOI, PSA, Title
            clear, Financing secured, Closing) and the tasks that feed into
            each. AI-suggest from deal documents or seed stage defaults.
          </p>
        </div>
        <ProjectManagement dealId={params.id} />
      </div>
    </div>
  );
}
