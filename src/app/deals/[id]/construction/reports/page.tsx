import ProgressReports from "@/components/ProgressReports";

export default function ReportsPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Progress Reports</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Weekly and monthly construction progress reports. Share a link with your contractor
          to collect updates and photos, then generate AI-enhanced narratives for investors.
        </p>
      </div>
      <ProgressReports dealId={params.id} />
    </div>
  );
}
