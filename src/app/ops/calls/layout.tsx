import { type ReactNode, Suspense } from "react";
import { NavPills } from "@/components/shell/nav";

/** The Calls tab's inner navigation: Sets (each run of a batch) and Calls (every individual call). */
export default function CallsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-6">
      {/* The pills read the URL, which on a set's page isn't known until the request. */}
      <Suspense fallback={<div className="h-7" />}>
        <NavPills
          ariaLabel="Sets and calls"
          variant="secondary"
          items={[
            { href: "/ops/calls/sets", label: "Sets" },
            { href: "/ops/calls", label: "Calls", exact: true },
          ]}
        />
      </Suspense>
      {children}
    </div>
  );
}
