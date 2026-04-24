"use client";

import DevelopmentSchedule from "@/components/DevelopmentSchedule";
import { OtherTrackLinks } from "@/components/schedule/TrackSchedule";

export default function DesignPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-8">
      <OtherTrackLinks dealId={params.id} current="development" />
      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">Design</h2>
          <p className="text-sm text-muted-foreground mt-1">
            AIA design phases (SD / DD / CDs) and utility coordination. Track
            submittal packages, design review responses, and will-serve letters
            as child tasks under each phase.
          </p>
        </div>
        <DevelopmentSchedule dealId={params.id} workstreams={["design"]} hideBudget />
      </div>
    </div>
  );
}
