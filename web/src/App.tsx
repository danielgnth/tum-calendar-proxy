import { type FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import { currentCredentials, login, logout } from "./api.ts";
import { Dashboard } from "./Dashboard.tsx";
import { EventPage } from "./EventPage.tsx";
import { Link, subscribePath } from "./lib.tsx";

function subscribeCredentials(cb: () => void) {
  window.addEventListener("tumcal:credentials", cb);
  return () => window.removeEventListener("tumcal:credentials", cb);
}

// ---- login -------------------------------------------------------------------

function Login(props: { hint?: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="narrow">
      <div className="card login">
        <h1>TUM Calendar</h1>
        <p className="muted">
          {props.hint ??
            "Clean up your TUMonline calendar: shorter names, hidden courses and events, room links and notes."}
        </p>
        <form onSubmit={submit}>
          <label htmlFor="url">Your TUMonline calendar link</label>
          <input
            id="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://campus.tum.de/tumonlinej/de/termin/ical?pStud=…&pToken=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary" disabled={busy || !url}>
            {busy ? "Checking with TUMonline…" : "Continue"}
          </button>
        </form>
        <details className="help">
          <summary>Where do I find this link?</summary>
          <ol>
            <li>
              Open{" "}
              <a href="https://campus.tum.de" target="_blank" rel="noreferrer">
                TUMonline
              </a>{" "}
              and go to <b>Calendar</b> (Kalender).
            </li>
            <li>
              Click <b>Publish</b> (Veröffentlichen) and copy the iCal link. Existing cal.tum.app links work too.
            </li>
          </ol>
          <p className="muted small">
            Your token is not stored on this server. It stays in your calendar link and in this browser; the server only
            keeps a hash of it to find your settings.
          </p>
        </details>
      </div>
    </main>
  );
}

// ---- root --------------------------------------------------------------------

export function App() {
  const path = useSyncExternalStore(subscribePath, () => location.pathname);
  const credentials = useSyncExternalStore(subscribeCredentials, currentCredentials);
  const [urlLogin, setUrlLogin] = useState<"pending" | "done" | string>(() =>
    /pToken=/.test(location.search) ? "pending" : "done",
  );

  // A login link (/?pStud=…&pToken=…) logs in directly; the token is removed from the address bar.
  useEffect(() => {
    if (urlLogin !== "pending") return;
    const href = location.href;
    history.replaceState(null, "", location.pathname);
    login(href).then(
      () => setUrlLogin("done"),
      (err: Error) => setUrlLogin(err.message),
    );
  }, [urlLogin]);

  if (urlLogin === "pending")
    return (
      <main className="narrow">
        <p className="muted center">Logging in…</p>
      </main>
    );

  const eventMatch = /^\/event\/(.+)$/.exec(path);
  if (!credentials) {
    const hint = eventMatch
      ? "Log in once on this device to hide or comment on events from your calendar app."
      : urlLogin !== "done"
        ? urlLogin
        : undefined;
    return <Login hint={hint} />;
  }

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} /> TUM Calendar
        </Link>
        <button type="button" className="ghost" onClick={logout}>
          Log out
        </button>
      </header>
      {eventMatch ? <EventPage uid={decodeURIComponent(eventMatch[1])} /> : <Dashboard />}
    </>
  );
}
