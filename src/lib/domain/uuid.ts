const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is a well-formed UUID (ids in URLs and forms are checked before querying with them). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
