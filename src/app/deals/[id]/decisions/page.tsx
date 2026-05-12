import { redirect } from "next/navigation";

export default function DecisionsRedirect({ params }: { params: { id: string } }) {
  redirect(`/deals/${params.id}/tasks?kind=decision`);
}
