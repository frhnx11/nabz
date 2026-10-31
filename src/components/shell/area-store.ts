/**
 * Per-tab memory (sessionStorage): cleared when the tab closes. Every access is guarded, because
 * storage can be unavailable (private mode, blocked site data) and the app must work without it.
 */

const CHANGE_EVENT = "nabz:area-memory";

export function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: resuming is a convenience, so silently skip it.
  }
}

export function removeSession(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore, as above.
  }
}

/** Tells subscribers (the area switch) that a remembered location changed. */
export function notifyAreaMemory(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeAreaMemory(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
