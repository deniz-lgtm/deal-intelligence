"use client";

import DevelopmentSchedule from "@/components/DevelopmentSchedule";
import { OtherTrackLinks } from "@/components/schedule/TrackSchedule";

export default function EntitlementsPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-8">
      <OtherTrackLinks dealId={params.id} current="development" />
      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">Entitlements</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Entitlement pathway (by-right / ministerial / discretionary / rezone)
            and stakeholder outreach. Seed child tasks from a scenario or a
            saved template; AI-suggest jurisdiction-specific tasks from the
            deal&apos;s zoning analysis.
          </p>
        </div>
        <DevelopmentSchedule
          dealId={params.id}
          workstreams={["entitlements"]}
          hideBudget
        />
      </div>
    </div>
  );
}
