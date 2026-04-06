import { NextRequest, NextResponse } from "next/server";
import { userQueries, ALL_PERMISSIONS } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: adminId, errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  const { id } = await params;
  let body: { role?: string; permissions?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const target = await userQueries.getById(id);
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  try {
    if (body.role !== undefined) {
      if (body.role !== "user" && body.role !== "admin") {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      // Prevent the last admin from demoting themselves and locking everyone out
      if (id === adminId && body.role !== "admin") {
        const all = await userQueries.listAll();
        const otherAdmins = all.filter((u) => u.role === "admin" && u.id !== adminId);
        if (otherAdmins.length === 0) {
          return NextResponse.json(
            { error: "Cannot demote the last admin" },
            { status: 400 }
          );
        }
      }
      await userQueries.setRole(id, body.role);
    }

    if (body.permissions !== undefined) {
      if (!Array.isArray(body.permissions)) {
        return NextResponse.json({ error: "permissions must be an array" }, { status: 400 });
      }
      const valid = body.permissions.filter((p): p is string =>
        typeof p === "string" && (ALL_PERMISSIONS as readonly string[]).includes(p)
      );
      await userQueries.setPermissions(id, valid);
    }

    const updated = await userQueries.getById(id);
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/admin/users/[id] error:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
