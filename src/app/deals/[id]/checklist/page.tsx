import { redirect } from "next/navigation";

export default function ChecklistRedirect({ params }: { params: { id: string } }) {
  redirect(`/deals/${params.id}/tasks?kind=diligence`);
}
