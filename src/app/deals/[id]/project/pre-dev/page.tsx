"use client";

import DevelopmentSchedule from "@/components/DevelopmentSchedule";
import { OtherTrackLinks } from "@/components/schedule/TrackSchedule";

export default function PreDevPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-8">
      <OtherTrackLinks dealId={params.id} current="development" />
      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">Pre-Development</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Feasibility study, financial model refresh, consultant onboarding, and
            site investigation (survey / geotech / Phase I ESA) — plus the
            itemized pre-dev soft-cost budget with approval gates.
          </p>
        </div>
        <DevelopmentSchedule dealId={params.id} workstreams={["pre_dev"]} />
      </div>
    </div>
  );
}
