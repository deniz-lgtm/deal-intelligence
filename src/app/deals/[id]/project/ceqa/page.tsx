"use client";

import CEQATracker from "@/components/CEQATracker";
import { OtherTrackLinks } from "@/components/schedule/TrackSchedule";

export default function CEQAPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-8">
      <OtherTrackLinks dealId={params.id} current="development" />
      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">CEQA Process Tracker</h2>
          <p className="text-sm text-muted-foreground mt-1">
            California Environmental Quality Act review pathway, process steps,
            mitigation measures, and public hearings.
          </p>
        </div>
        <CEQATracker dealId={params.id} />
      </div>
    </div>
  );
}
