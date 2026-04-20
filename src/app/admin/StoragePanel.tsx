import { usageQueries } from "@/lib/db";

// Format a byte count in the most readable unit. Matches the convention
// most cloud dashboards use (MB to one decimal, GB to two) so admin
// numbers feel familiar at a glance.
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const fn = (n: number) => (n || 0).toLocaleString("en-US");

export default async function StoragePanel() {
  const [perUser, totals] = await Promise.all([
    usageQueries.getStorageByUser(),
    usageQueries.getStorageTotals(),
  ]);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">Storage</h2>
        <span className="text-xs text-neutral-500">
          From documents + photos. Each user is their own workspace.
        </span>
      </div>

      {/* Top-line totals — one card per dimension so trend changes
          across users are easy to eyeball without scanning the table. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">Total storage</p>
          <p className="text-xl font-semibold tabular-nums">{formatBytes(totals.total_bytes)}</p>
          <p className="text-[10px] text-neutral-500 mt-0.5">
            {fn(totals.doc_count)} docs + {fn(totals.photo_count)} photos
          </p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">Documents</p>
          <p className="text-xl font-semibold tabular-nums">{formatBytes(totals.doc_bytes)}</p>
          <p className="text-[10px] text-neutral-500 mt-0.5">{fn(totals.doc_count)} files</p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">Photos</p>
          <p className="text-xl font-semibold tabular-nums">{formatBytes(totals.photo_bytes)}</p>
          <p className="text-[10px] text-neutral-500 mt-0.5">{fn(totals.photo_count)} files</p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">Activity</p>
          <p className="text-xl font-semibold tabular-nums">{fn(totals.user_count)}</p>
          <p className="text-[10px] text-neutral-500 mt-0.5">
            users · {fn(totals.deal_count)} deals
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-900 text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="text-left px-3 py-2 font-medium">User</th>
              <th className="text-right px-3 py-2 font-medium">Deals</th>
              <th className="text-right px-3 py-2 font-medium">Docs</th>
              <th className="text-right px-3 py-2 font-medium">Photos</th>
              <th className="text-right px-3 py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {perUser.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-neutral-500 text-xs">
                  No users yet.
                </td>
              </tr>
            ) : (
              perUser.map((u) => {
                const isEmpty = u.total_bytes === 0 && u.deal_count === 0;
                return (
                  <tr
                    key={u.user_id}
                    className={`border-t border-neutral-800 hover:bg-neutral-900/50 ${isEmpty ? "text-neutral-600" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-neutral-100">
                        {u.name || u.email}
                      </div>
                      {u.name && (
                        <div className="text-[10px] text-neutral-500">{u.email}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fn(u.deal_count)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div>{formatBytes(u.doc_bytes)}</div>
                      <div className="text-[10px] text-neutral-500">{fn(u.doc_count)} files</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div>{formatBytes(u.photo_bytes)}</div>
                      <div className="text-[10px] text-neutral-500">{fn(u.photo_count)} files</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {formatBytes(u.total_bytes)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
