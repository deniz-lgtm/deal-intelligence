import DevelopmentSchedule from "@/components/DevelopmentSchedule";

export default function MasterSchedulePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Master Schedule</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          One editable schedule across acquisition, development, and construction.
          Use the track selector on new rows when adding directly from the master view.
        </p>
      </div>
      <DevelopmentSchedule dealId={params.id} track="all" hideBudget />
    </div>
  );
}
