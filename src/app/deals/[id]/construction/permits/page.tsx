import PermitTracker from "@/components/PermitTracker";

export default function PermitsPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Permits & Approvals</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Track permits with submission and approval lifecycle.
        </p>
      </div>
      <PermitTracker dealId={params.id} />
    </div>
  );
}
