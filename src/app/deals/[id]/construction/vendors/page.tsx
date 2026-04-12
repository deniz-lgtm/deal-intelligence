import VendorDirectory from "@/components/VendorDirectory";

export default function VendorsPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Vendor & Contractor Directory</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Central list of all parties working on this deal.
        </p>
      </div>
      <VendorDirectory dealId={params.id} />
    </div>
  );
}
