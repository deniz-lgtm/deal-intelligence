import ProjectManagement from "@/components/ProjectManagement";
import DevelopmentSchedule from "@/components/DevelopmentSchedule";
import CEQATracker from "@/components/CEQATracker";

export default function ProjectPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-8">
      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">Project Management</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track milestones, tasks, and deadlines for this deal.
          </p>
        </div>
        <ProjectManagement dealId={params.id} />
      </div>

      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">Development Schedule & Pre-Dev Budget</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Phase-by-phase development timeline and itemized pre-development spend with approval gates.
          </p>
        </div>
        <DevelopmentSchedule dealId={params.id} />
      </div>

      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold">CEQA Process Tracker</h2>
          <p className="text-sm text-muted-foreground mt-1">
            California Environmental Quality Act review pathway, process steps, mitigation measures, and public hearings.
          </p>
        </div>
        <CEQATracker dealId={params.id} />
      </div>
    </div>
  );
}
