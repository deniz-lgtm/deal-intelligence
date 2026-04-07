import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { ClerkProvider, UserButton } from "@clerk/nextjs";

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
          {/* Global user button — floats top-right. Admin link has moved
              into each page's own nav (sidebar on deal pages, header nav
              on the deal list). */}
          <div className="fixed top-3 right-4 z-50 flex items-center gap-3">
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
