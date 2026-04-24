"use client";

import DevelopmentSchedule from "@/components/DevelopmentSchedule";
import { OtherTrackLinks } from "@/components/schedule/TrackSchedule";

export default function ProcurementPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-8">
      <OtherTrackLinks dealId={params.id} current="development" />
      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">Procurement &amp; Preconstruction</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Bid package prep, GC selection, preconstruction services, GMP
            negotiation, and subcontractor buyout — plus the two financing
            milestones that gate vertical (construction loan close and NTP).
          </p>
        </div>
        <DevelopmentSchedule
          dealId={params.id}
          workstreams={["procurement", "financing"]}
          hideBudget
        />
      </div>
    </div>
  );
}
