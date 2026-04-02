import ProjectManagement from "@/components/ProjectManagement";

export default function ProjectPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Project Management</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Track milestones, tasks, and deadlines for this deal.
        </p>
      </div>
      <ProjectManagement dealId={params.id} />
    </div>
  );
}
