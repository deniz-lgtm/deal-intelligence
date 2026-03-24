import DiligenceChecklist from "@/components/DiligenceChecklist";

export default function ChecklistPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Diligence Checklist</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Track due diligence progress. Click any item to cycle its status, or
          use AI Auto-fill to analyze uploaded documents automatically.
        </p>
      </div>
      <DiligenceChecklist dealId={params.id} />
    </div>
  );
}
