import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { userQueries, ALL_PERMISSIONS } from "@/lib/db";
import { syncCurrentUser } from "@/lib/auth";
import AdminUsersTable from "./AdminUsersTable";
import InvitationsPanel from "./InvitationsPanel";
import SignupAllowlistPanel from "./SignupAllowlistPanel";
import AiConfigPanel from "./AiConfigPanel";
import PipelinePanel from "./PipelinePanel";
import ChecklistTemplatePanel from "./ChecklistTemplatePanel";
import ContactsPanel from "./ContactsPanel";
import AuditLogPanel from "./AuditLogPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  await syncCurrentUser(userId);
  const me = await userQueries.getById(userId);
  if (!me || me.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold">Access denied</h1>
          <p className="text-neutral-400">
            You need admin privileges to view this page. Ask the owner to grant
            you access, or set <code className="text-neutral-200">ADMIN_EMAILS</code> in
            the environment to bootstrap an initial admin.
          </p>
          <Link href="/" className="inline-block text-sm text-indigo-400 hover:underline">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const users = await userQueries.listAll();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Admin Portal</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Manage user roles and feature permissions.
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-neutral-400 hover:text-neutral-100"
          >
            ← Dashboard
          </Link>
        </div>

        <div className="space-y-10">
          <section>
            <h2 className="text-lg font-semibold mb-3">Users</h2>
            <AdminUsersTable
              initialUsers={users}
              allPermissions={ALL_PERMISSIONS as unknown as string[]}
              currentUserId={userId}
            />
          </section>

          <InvitationsPanel />
          <SignupAllowlistPanel />
          <ContactsPanel />
          <AiConfigPanel />
          <PipelinePanel />
          <ChecklistTemplatePanel />
          <AuditLogPanel />
        </div>
      </div>
    </div>
  );
}
