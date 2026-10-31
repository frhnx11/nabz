/**
 * The two areas of the app and the per-tab memory of where you were in each.
 * Pure helpers (no DOM), so they can be unit-tested; the components use them with sessionStorage.
 */

export const AREAS = ["client", "ops"] as const;
export type Area = (typeof AREAS)[number];

export const AREA_HOME: Record<Area, string> = { client: "/pulse", ops: "/ops/dealers" };

const CLIENT_ROUTES = ["/pulse", "/heatmap"];

function underRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** Which area a path belongs to, or null for anything else (e.g. a 404). */
export function areaOf(pathname: string): Area | null {
  if (underRoute(pathname, "/ops")) return "ops";
  if (CLIENT_ROUTES.some((r) => underRoute(pathname, r))) return "client";
  return null;
}

/** Pages worth returning to: any real page of either area ("/ops" itself only redirects). */
export function shouldRemember(pathname: string): boolean {
  return areaOf(pathname) !== null && pathname !== "/ops";
}

/** sessionStorage keys. Namespaced so nothing else on the origin collides with them. */
export const storageKey = {
  last: (area: Area) => `nabz:last:${area}`,
  scroll: (location: string) => `nabz:scroll:${location}`,
  restore: "nabz:restore",
};

/**
 * Validates a remembered location before navigating to it: a same-origin path (no scheme, no
 * protocol-relative "//", no backslashes or whitespace) that belongs to the expected area.
 * Anything else, including a tampered value, gives null and the caller uses the area's home.
 */
export function validLocation(area: Area, value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return null;
  const pathname = value.split(/[?#]/, 1)[0] ?? "";
  if (areaOf(pathname) !== area || !shouldRemember(pathname)) return null;
  return value;
}

/**
 * A pending "restore after switching area" request: the page being switched to and the scroll
 * position it had, captured at click time (before the new page's own scroll events can overwrite it).
 */
export type RestoreRequest = { to: string; y: number };

export function encodeRestore(request: RestoreRequest): string {
  return JSON.stringify(request);
}

export function decodeRestore(value: string | null | undefined): RestoreRequest | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { to, y } = parsed as Record<string, unknown>;
    if (typeof to !== "string" || typeof y !== "number") return null;
    const area = areaOf(to.split(/[?#]/, 1)[0] ?? "");
    const scroll = validScroll(String(y));
    if (!area || validLocation(area, to) === null || scroll === null) return null;
    return { to, y: scroll };
  } catch {
    return null;
  }
}

/** Parses a stored scroll position; null unless it's a sane, finite, non-negative number. */
export function validScroll(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? Math.round(n) : null;
}
