import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Deal Intelligence",
  description: "AI-powered deal intelligence and due diligence platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
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
  );
}
