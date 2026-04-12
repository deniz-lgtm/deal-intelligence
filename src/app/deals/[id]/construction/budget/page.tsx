import HardCostBudget from "@/components/HardCostBudget";

export default function BudgetPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Hard Cost Budget</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Track construction costs by category with approval thresholds.
        </p>
      </div>
      <HardCostBudget dealId={params.id} />
    </div>
  );
}
