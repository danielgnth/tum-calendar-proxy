import { createHash } from "node:crypto";

/**
 * TUMonline calendar credentials. They are never written to disk: they live in the
 * subscription URL and in the browser, and the server only stores a hash of them.
 */
export interface Credentials {
  kind: "pStud" | "pPers";
  id: string;
  token: string;
}

const reId = /\b(pStud|pPers)=([0-9A-Za-z]{1,64})\b/;
const reToken = /\bpToken=([0-9A-Za-z]{1,128})\b/;

/**
 * Extracts credentials from anything that contains them: a TUMonline iCal URL,
 * a cal.tum.app URL, one of our own feed/login URLs or a bare query string.
 */
export function parseCredentials(input: string | null | undefined): Credentials | null {
  if (!input) return null;
  const text = input.replace(/\s+/g, "");
  const id = reId.exec(text);
  const token = reToken.exec(text);
  if (!id || !token) return null;
  return { kind: id[1] as Credentials["kind"], id: id[2], token: token[1] };
}

export function credentialsQuery(c: Credentials): string {
  return new URLSearchParams({ [c.kind]: c.id, pToken: c.token }).toString();
}

/**
 * Identifies a feed's stored settings. The token is a long random value issued by
 * TUMonline, so a plain SHA-256 cannot be reversed or brute-forced in practice.
 */
export function credentialsHash(c: Credentials): string {
  return createHash("sha256").update(`${c.kind}:${c.id}:${c.token}`).digest("hex");
}

export function tumOnlineUrl(c: Credentials): string {
  return `https://campus.tum.de/tumonlinej/ws/termin/ical?${credentialsQuery(c)}`;
}

/** Replaces tokens in a path or URL for logging. */
export function redact(text: string): string {
  return text.replace(/\b(pStud|pPers|pToken)=([0-9A-Za-z]{0,4})[0-9A-Za-z]*/g, "$1=$2…");
}
