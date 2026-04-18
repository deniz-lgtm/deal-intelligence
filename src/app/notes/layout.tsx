// Opt /notes out of static prerendering. The hub's client component uses
// useSearchParams() to scope to a specific deal via ?deal=<id>, and Next.js
// 14 fails the build on prerender unless useSearchParams is wrapped in
// <Suspense> or the segment opts out of static generation. Forcing dynamic
// at the segment level is simpler and keeps the page as a single client
// component.
export const dynamic = "force-dynamic";

export default function NotesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
