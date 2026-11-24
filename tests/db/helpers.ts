import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

/** A new, independent database session (its own backend process). */
export async function session(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: inject("dbUrl") });
  await client.connect();
  return client;
}

export type Actor =
  | { kind: "anon" }
  | { kind: "user"; id: string; aal?: "aal1" | "aal2" };

/** Make this session act like a request from the given person, as PostgREST does. */
export async function actAs(client: pg.Client, actor: Actor) {
  await client.query("reset role");
  if (actor.kind === "anon") {
    await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "anon" })]);
    await client.query("set role anon");
    return;
  }
  const claims = { sub: actor.id, role: "authenticated", aal: actor.aal ?? "aal1" };
  await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await client.query("set role authenticated");
}

/** Back to the test's own superuser view (no JWT). */
export async function asOwner(client: pg.Client) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims', '', false)");
}

export type PersonOptions = {
  admin?: boolean;
  mainAdmin?: boolean;
  active?: boolean;
  pageAccess?: Record<string, "edit" | "view" | "none"> | null;
  name?: string;
};

/** Create an account (auth user → profile) with the given access. Runs as owner. */
export async function createPerson(client: pg.Client, opts: PersonOptions = {}): Promise<string> {
  const id = randomUUID();
  const name = opts.name ?? `Test ${id.slice(0, 6)}`;
  await asOwner(client);
  await client.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    `${id.slice(0, 8)}@example.test`,
    JSON.stringify({ full_name: name }),
  ]);
  await client.query(
    "update public.profiles set is_admin = $2, is_main_admin = $3, is_active = $4, page_access = $5 where id = $1",
    [id, Boolean(opts.admin || opts.mainAdmin), Boolean(opts.mainAdmin), opts.active ?? true, opts.pageAccess ? JSON.stringify(opts.pageAccess) : null],
  );
  return id;
}

let batchCounter = 0;
export async function createBatch(client: pg.Client): Promise<string> {
  await asOwner(client);
  batchCounter += 1;
  const { rows } = await client.query("insert into public.batches (name) values ($1) returning id", [
    `Batch ${Date.now()}-${batchCounter}`,
  ]);
  return rows[0].id;
}

/** Run a query and return the Postgres error code, or "ok". */
export async function outcome(client: pg.Client, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await client.query(sql, params);
    return "ok";
  } catch (err) {
    return (err as { code?: string }).code ?? "error";
  }
}

/**
 * Add a catalog tute (Tute stock) and schedule it for a class in the given
 * months (SQL date expressions), as the current actor.
 */
export async function createTute(
  client: pg.Client,
  classId: string,
  name: string,
  months: string[],
  code = "",
): Promise<string> {
  const { rows } = await client.query("select public.tute_save(null, $1, $2) as id", [name, code]);
  for (const month of months) {
    await client.query(`select public.class_month_tute_attach($1, ${month}, $2)`, [classId, rows[0].id]);
  }
  return rows[0].id;
}
