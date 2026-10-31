"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { areaOf, decodeRestore, shouldRemember, storageKey } from "./area";
import { notifyAreaMemory, readSession, removeSession, writeSession } from "./area-store";

const RESTORE_TIMEOUT_MS = 1500;

/** The current address as a path plus query, read at the moment it's needed. */
function currentLocation(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Remembers, for this tab, the last page (with its query) visited in each area and the scroll
 * position of every page, and restores the scroll after an area switch. Renders nothing.
 */
export function AreaMemory() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const location = search ? `${pathname}?${search}` : pathname;

  // 1. Remember the page as "last visited" for its area.
  useEffect(() => {
    const area = areaOf(pathname);
    if (!area || !shouldRemember(pathname)) return;
    writeSession(storageKey.last(area), location);
    notifyAreaMemory();
  }, [pathname, location]);

  // 2. Remember scroll positions. The key is read from the address bar when the save happens, so a
  //    scroll caused by a navigation is always filed under the page it belongs to.
  useEffect(() => {
    let frame = 0;
    const save = () => {
      frame = 0;
      if (shouldRemember(window.location.pathname)) {
        writeSession(storageKey.scroll(currentLocation()), String(Math.round(window.scrollY)));
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(save);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
    };
  }, []);

  // 3. After an area switch, put the page back where it was (top of the page if never scrolled).
  useEffect(() => {
    const raw = readSession(storageKey.restore);
    if (!raw) return;
    // "/ops" only redirects; keep the request for the page it redirects to.
    if (!shouldRemember(pathname)) return;
    removeSession(storageKey.restore);
    const request = decodeRestore(raw);
    if (!request || request.to !== location) return;

    const { y } = request;
    const started = performance.now();
    let frame = 0;
    // Ops pages stream their data in, so wait until the page is tall enough (or give up gracefully).
    const attempt = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max >= y || performance.now() - started > RESTORE_TIMEOUT_MS) {
        window.scrollTo({ top: Math.min(y, Math.max(0, max)), behavior: "instant" });
        return;
      }
      frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [pathname, location]);

  return null;
}
