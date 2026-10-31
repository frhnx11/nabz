import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { AreaMemory } from "@/components/shell/area-memory";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Nabz · India's demand, heard before the data",
    template: "%s · Nabz",
  },
  description:
    "Weekly demand indices for India's offline economy, built from short AI phone surveys of businesses. Vehicles first.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-bg text-ink">
        {/* Exactly one instance, here in the root layout: area layouts are kept alive (hidden) by
            Next between navigations, so a copy inside them would compete for the scroll restore.
            It reads the query string (suspends while prerendering) and renders nothing. */}
        <Suspense fallback={null}>
          <AreaMemory />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
