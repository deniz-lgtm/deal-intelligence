import BudgetSheet from "@/components/BudgetSheet";

export default function BudgetPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold">Budget</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Schedule of values + draws in one sheet. Hard costs, soft costs, and contingency in a single view, with version snapshots for VE iterations.
        </p>
      </div>
      <BudgetSheet dealId={params.id} />
    </div>
  );
}
