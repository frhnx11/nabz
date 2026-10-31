import type { ReactNode } from "react";

/** Heading of a box on the client pages. */
export function BoxHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="grid min-w-0 gap-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-base text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
