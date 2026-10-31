import type { Metadata } from "next";
import { SiteHeader } from "@/components/shell/site-header";

export const metadata: Metadata = {
  title: { default: "Ops console", template: "%s · Nabz ops" },
  robots: { index: false, follow: false },
};

export default function OpsLayout({ children }: LayoutProps<"/ops">) {
  return (
    <>
      <SiteHeader area="ops" />
      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-[minmax(0,1fr)] content-start gap-6 px-4 py-8 sm:px-6">
        {children}
      </main>
    </>
  );
}
