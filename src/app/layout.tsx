import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { userQueries } from "@/lib/db";
import { syncCurrentUser } from "@/lib/auth";

async function AdminNavLink() {
  try {
    const { userId } = await auth();
    if (!userId) return null;
    await syncCurrentUser(userId);
    const me = await userQueries.getById(userId);
    if (!me || me.role !== "admin") return null;
    return (
      <Link
        href="/admin"
        className="text-xs font-medium px-2.5 py-1 rounded-md border border-indigo-500/40 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20"
      >
        Admin
      </Link>
    );
  } catch {
    return null;
  }
}

export const metadata: Metadata = {
  title: "Deal Intelligence",
  description: "AI-powered deal intelligence and due diligence platform",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Outfit:wght@300;400;500;600;700&display=swap"
            rel="stylesheet"
          />
        </head>
        <body>
          {/* Global user button — floats top-right on pages that don't have their own nav header */}
          <div className="fixed top-3 right-4 z-50 flex items-center gap-3">
            <AdminNavLink />
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-7 w-7",
                },
              }}
            />
          </div>
          {children}
          <Toaster
            position="bottom-right"
            theme="dark"
            richColors
            toastOptions={{
              className: "shadow-lifted",
              style: {
                borderRadius: "0.75rem",
                background: "hsl(240 5% 15%)",
                border: "1px solid hsl(240 4% 22%)",
                color: "hsl(40 20% 96%)",
              },
            }}
          />
        </body>
      </html>
    </ClerkProvider>
  );
}
