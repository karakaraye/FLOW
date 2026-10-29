import type { Metadata } from "next";
import "./globals.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: {
    default: "FlowPilot AI — Make room for meaningful work",
    template: "%s | FlowPilot AI",
  },
  description:
    "Your future workspace for thoughtful automation. Explore FlowPilot AI's workflow, template, and integration previews.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-white focus:p-3"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
