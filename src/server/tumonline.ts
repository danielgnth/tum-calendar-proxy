import { type Credentials, credentialsHash, tumOnlineUrl } from "./credentials.ts";

export class UpstreamError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export interface FetchedCalendar {
  ics: string;
  fetchedAt: Date;
}

export type CalendarSource = (c: Credentials, opts?: { refresh?: boolean }) => Promise<FetchedCalendar>;

/**
 * Fetches calendars from TUMonline with a short in-memory cache, so the web UI and
 * calendar clients refreshing at the same time don't hit TUMonline repeatedly.
 * The cache is keyed by the credentials hash and never persisted.
 */
export function createTumOnlineSource(opts: {
  ttlMs: number;
  maxEntries?: number;
  timeoutMs?: number;
}): CalendarSource {
  const maxEntries = opts.maxEntries ?? 200;
  const cache = new Map<string, { at: number; value: Promise<FetchedCalendar> }>();

  async function load(c: Credentials): Promise<FetchedCalendar> {
    let res: Response;
    try {
      res = await fetch(tumOnlineUrl(c), { signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000) });
    } catch (err) {
      throw new UpstreamError(`TUMonline is not reachable (${(err as Error).message})`);
    }
    const body = await res.text();
    if (!res.ok) throw new UpstreamError(`TUMonline answered with HTTP ${res.status}`);
    if (!body.trimStart().startsWith("BEGIN:VCALENDAR")) {
      throw new UpstreamError("TUMonline did not return a calendar. Check that the link and token are correct.", 401);
    }
    return { ics: body, fetchedAt: new Date() };
  }

  return (c, { refresh = false } = {}) => {
    const key = credentialsHash(c);
    const hit = cache.get(key);
    if (hit && !refresh && Date.now() - hit.at < opts.ttlMs) return hit.value;

    const value = load(c);
    cache.delete(key);
    cache.set(key, { at: Date.now(), value });
    value.catch(() => cache.get(key)?.value === value && cache.delete(key));
    for (const oldest of cache.keys()) {
      if (cache.size <= maxEntries) break;
      cache.delete(oldest);
    }
    return value;
  };
}
