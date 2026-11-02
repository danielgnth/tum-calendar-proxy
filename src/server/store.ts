import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type ConfigPatch, DEFAULT_OPTIONS, type FeedConfig } from "../shared/types.ts";

const courseRule = z.strictObject({ hidden: z.boolean().optional(), name: z.string().max(200).optional() });
const seriesRule = z.strictObject({ hidden: z.boolean().optional() });
const eventRule = z.strictObject({
  hidden: z.boolean().optional(),
  note: z.string().max(4000).optional(),
  fallbackKey: z.string().max(1000).optional(),
});
const options = z.strictObject({
  navLinks: z.boolean(),
  manageLinks: z.boolean(),
  hideCancelled: z.boolean(),
  originalTitleInDescription: z.boolean(),
});
const key = z.string().min(1).max(1000);

export const configPatchSchema = z.strictObject({
  options: options.partial().optional(),
  courses: z.record(key, courseRule.nullable()).optional(),
  series: z.record(key, seriesRule.nullable()).optional(),
  events: z.record(key, eventRule.omit({ fallbackKey: true }).nullable()).optional(),
});

const storedConfig = z.object({
  version: z.literal(1),
  options: options.partial().default({}),
  courses: z.record(key, courseRule).default({}),
  series: z.record(key, seriesRule).default({}),
  events: z.record(key, eventRule).default({}),
  updatedAt: z.string().optional(),
});

export function emptyConfig(): FeedConfig {
  return { version: 1, options: { ...DEFAULT_OPTIONS }, courses: {}, series: {}, events: {} };
}

/** Drops falsy fields and empty entries so the stored file only holds what was changed. */
function compact<T extends object>(rule: T): T | null {
  const entries = Object.entries(rule).filter(([, v]) => v !== false && v !== "" && v != null);
  return entries.length ? (Object.fromEntries(entries) as T) : null;
}

function mergeRecord<T extends object>(target: Record<string, T>, patch: Record<string, T | null> | undefined) {
  for (const [k, value] of Object.entries(patch ?? {})) {
    const merged = value === null ? null : compact({ ...target[k], ...value });
    if (merged) target[k] = merged;
    else delete target[k];
  }
}

export function applyPatch(config: FeedConfig, patch: ConfigPatch): FeedConfig {
  const next = structuredClone(config);
  Object.assign(next.options, patch.options);
  mergeRecord(next.courses, patch.courses);
  mergeRecord(next.series, patch.series);
  mergeRecord(next.events, patch.events);
  // An event rule that only carries its fallback key has nothing left to do.
  for (const [uid, rule] of Object.entries(next.events)) {
    if (!rule.hidden && !rule.note) delete next.events[uid];
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * Stores one JSON file per feed, named by the credentials hash.
 * Writes are serialized per feed and replace the file atomically.
 */
export class ConfigStore {
  private readonly dir: string;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, "feeds");
  }

  private file(hash: string): string {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("invalid feed hash");
    return join(this.dir, `${hash}.json`);
  }

  async exists(hash: string): Promise<boolean> {
    return (await this.read(hash)) !== null;
  }

  async get(hash: string): Promise<FeedConfig> {
    return (await this.read(hash)) ?? emptyConfig();
  }

  private async read(hash: string): Promise<FeedConfig | null> {
    let raw: string;
    try {
      raw = await readFile(this.file(hash), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const parsed = storedConfig.parse(JSON.parse(raw));
    return { ...parsed, options: { ...DEFAULT_OPTIONS, ...parsed.options } };
  }

  /** Creates the file if it does not exist yet (first login). */
  async ensure(hash: string): Promise<void> {
    await this.update(hash, (c) => c);
  }

  update(hash: string, change: (config: FeedConfig) => FeedConfig | Promise<FeedConfig>): Promise<FeedConfig> {
    const run = async () => {
      const next = await change(await this.get(hash));
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.file(hash)}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, this.file(hash));
      return next;
    };
    const previous = this.queues.get(hash) ?? Promise.resolve();
    const result = previous.then(run, run);
    const settled = result.catch(() => {});
    this.queues.set(hash, settled);
    settled.then(() => this.queues.get(hash) === settled && this.queues.delete(hash));
    return result;
  }
}
