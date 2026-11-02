import type { CalendarView, ConfigPatch, EventView } from "../../src/shared/types.ts";

// The TUMonline credentials ("pStud=…&pToken=…") live only in this browser.
const STORAGE_KEY = "tumcal.credentials";

function getCredentials(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setCredentials(value: string | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private mode): the session lasts until the tab closes
  }
  window.dispatchEvent(new Event("tumcal:credentials"));
}

let sessionCredentials: string | null = getCredentials();

export function currentCredentials(): string | null {
  return sessionCredentials;
}

export function logout() {
  sessionCredentials = null;
  setCredentials(null);
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (sessionCredentials) headers.set("X-Calendar-Credentials", sessionCredentials);
  const res = await fetch(`/api${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== "/login") logout();
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export async function login(url: string): Promise<void> {
  const { credentials } = await request<{ credentials: string }>("/login", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  sessionCredentials = credentials;
  setCredentials(credentials);
}

export const api = {
  calendar: (refresh = false) => request<CalendarView>(`/calendar${refresh ? "?refresh=1" : ""}`),
  patch: (patch: ConfigPatch) => request<CalendarView>("/config", { method: "PATCH", body: JSON.stringify(patch) }),
  event: (uid: string) => request<EventView>(`/events/${encodeURIComponent(uid)}`),
};
