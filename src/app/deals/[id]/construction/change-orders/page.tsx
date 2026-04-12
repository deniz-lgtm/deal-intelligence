import ChangeOrderTracker from "@/components/ChangeOrderTracker";

export default function ChangeOrdersPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Change Orders</h2>
        <p className="text-sm text-muted-foreground mt-1">Track change orders and their impact on budget and schedule.</p>
      </div>
      <ChangeOrderTracker dealId={params.id} />
    </div>
  );
}
