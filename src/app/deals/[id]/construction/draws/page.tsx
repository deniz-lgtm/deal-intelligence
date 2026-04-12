import DrawSchedule from "@/components/DrawSchedule";

export default function DrawsPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Draw Schedule</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Track lender draw requests against the construction budget.
        </p>
      </div>
      <DrawSchedule dealId={params.id} />
    </div>
  );
}
