import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ConfigStore } from "./store.ts";
import { createTumOnlineSource } from "./tumonline.ts";

const env = process.env;
const port = Number(env.PORT ?? 4321);
const dataDir = resolve(env.DATA_DIR ?? "data");

const app = createApp({
  source: createTumOnlineSource({ ttlMs: Number(env.CACHE_TTL_SECONDS ?? 300) * 1000 }),
  store: new ConfigStore(dataDir),
  publicUrl: env.PUBLIC_URL || undefined,
  openRegistration: (env.REGISTRATION ?? "open") !== "closed",
  // dist/server/main.js -> dist/web
  staticDir: resolve(import.meta.dirname, "../web"),
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`TUM calendar proxy listening on http://localhost:${info.port} (data: ${dataDir})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
