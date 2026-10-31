// Starts a throwaway PostgreSQL for the database tests, loads the Supabase
// shim and every migration, and deletes it all afterwards.
//
// Safety: tests only ever connect to this local database. A TEST_DATABASE_URL
// may be given (e.g. a CI service container) but must point at localhost.
// The production Supabase settings are removed from the environment.

import { execFileSync } from "node:child_process";
import { chownSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import type { TestProject } from "vitest/node";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
/** Migrations from here on must be safe to run twice; they are applied a second time. */
const SAFE_TWICE_FROM = "20261101000018";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

export function assertLocalUrl(url: string) {
  const { hostname } = new URL(url);
  if (!["localhost", "127.0.0.1", "::1", ""].includes(hostname) || url.includes("supabase.co")) {
    throw new Error(`Refusing to run database tests against a non-local database (${hostname}).`);
  }
}

function pgBinDir(): string {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const base = "/usr/lib/postgresql";
  const versions = existsSync(base) ? readdirSync(base).filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a)) : [];
  if (versions.length === 0) throw new Error("PostgreSQL server binaries not found. Set PG_BIN or TEST_DATABASE_URL.");
  return path.join(base, versions[0], "bin");
}

function startCluster(): { url: string; stop: () => void } {
  const bin = pgBinDir();
  const dir = mkdtempSync(path.join(tmpdir(), "dispatch-testdb-"));
  const data = path.join(dir, "data");
  const asRoot = process.getuid?.() === 0;
  if (asRoot) {
    // PostgreSQL refuses to run as root; use the postgres system user.
    const uid = Number(execFileSync("id", ["-u", "postgres"]).toString().trim());
    const gid = Number(execFileSync("id", ["-g", "postgres"]).toString().trim());
    chownSync(dir, uid, gid);
  }
  const run = (cmd: string, args: string[]) =>
    asRoot
      ? execFileSync("runuser", ["-u", "postgres", "--", path.join(bin, cmd), ...args], { stdio: "pipe" })
      : execFileSync(path.join(bin, cmd), args, { stdio: "pipe" });

  const port = 54000 + Math.floor(Math.random() * 5000);
  run("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale"]);
  run("pg_ctl", [
    "-D", data, "-w", "-l", path.join(dir, "server.log"),
    "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=50`,
    "start",
  ]);
  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    stop: () => {
      try {
        run("pg_ctl", ["-D", data, "-m", "immediate", "stop"]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** Supabase-only extensions are not available locally; the shim provides stubs instead. */
function localize(sql: string): string {
  return sql.replace(/create extension if not exists pg_net with schema extensions;/gi, "-- pg_net: stubbed by the test shim");
}

async function applyMigrations(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query("select current_setting('server_version_num')::int as v");
    if (rows[0].v < 170000) {
      console.warn(`[test:db] Local PostgreSQL ${rows[0].v} – production runs 17.x. CI should use 17.`);
    }
    await client.query(readFileSync(path.join(__dirname, "supabase-shim.sql"), "utf8"));
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      try {
        await client.query(localize(readFileSync(path.join(MIGRATIONS, file), "utf8")));
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    for (const file of files.filter((f) => f >= SAFE_TWICE_FROM)) {
      try {
        await client.query(localize(readFileSync(path.join(MIGRATIONS, file), "utf8")));
      } catch (err) {
        throw new Error(`Migration ${file} is not safe to run twice: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject) {
  for (const key of Object.keys(process.env)) {
    if (key.includes("SUPABASE")) delete process.env[key];
  }
  let url = process.env.TEST_DATABASE_URL;
  let stop = () => {};
  if (url) {
    assertLocalUrl(url);
  } else {
    const cluster = startCluster();
    url = cluster.url;
    stop = cluster.stop;
  }
  try {
    await applyMigrations(url);
  } catch (err) {
    stop();
    throw err;
  }
  project.provide("dbUrl", url);
  return () => stop();
}
