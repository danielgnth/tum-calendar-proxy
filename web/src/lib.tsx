import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { CalendarView, ConfigPatch } from "../../src/shared/types.ts";
import { api } from "./api.ts";

// ---- tiny router -------------------------------------------------------------

export function subscribePath(cb: () => void) {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
}

export function navigate(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function Link(props: { to: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={props.to}
      className={props.className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}

// ---- data --------------------------------------------------------------------

/** Loads the calendar view and applies changes; every change returns the updated view. */
export function useCalendar() {
  const [view, setView] = useState<CalendarView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (task: () => Promise<CalendarView>) => {
    setBusy(true);
    try {
      setView(await task());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    run(() => api.calendar());
  }, [run]);

  return {
    view,
    error,
    busy,
    refresh: () => run(() => api.calendar(true)),
    patch: (patch: ConfigPatch) => run(() => api.patch(patch)),
  };
}

// ---- controls ----------------------------------------------------------------

export function Switch(props: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="switch" title={props.label}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        aria-label={props.label}
      />
      <span />
    </label>
  );
}
