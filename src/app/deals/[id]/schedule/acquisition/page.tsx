import AcquisitionScheduleEditor from "@/components/schedule/AcquisitionScheduleEditor";

export default function AcquisitionSchedulePage({
  params,
}: {
  params: { id: string };
}) {
  return <AcquisitionScheduleEditor dealId={params.id} />;
}
