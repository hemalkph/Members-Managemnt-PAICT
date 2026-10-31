import type pg from "pg";
import { actAs, asOwner, type Actor } from "./helpers";

/** Synthetic students with complete delivery details. Runs as owner. */
export async function seedStudents(
  client: pg.Client,
  batch: string,
  numbers: string[],
  override: Partial<Record<"address_line1" | "city" | "phone1", string | null>> = {},
): Promise<string[]> {
  await asOwner(client);
  const ids: string[] = [];
  for (const no of numbers) {
    const { rows } = await client.query(
      `insert into public.students (batch_id, student_no, full_name, address_line1, city, phone1)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        batch,
        no,
        `Synthetic ${no}`,
        "address_line1" in override ? override.address_line1 : `${no} Test Road`,
        "city" in override ? override.city : "Kandy",
        "phone1" in override ? override.phone1 : "0771234567",
      ],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

export type PlannedRound = { round: string; tutes: string[] };

/** Create a draft round with manual tutes and the given students, as `actor`. */
export async function planRound(
  client: pg.Client,
  actor: Actor,
  batch: string,
  prefix: string,
  students: string[],
  opts: { tutes?: string[]; excluded?: Record<string, number[]>; cod?: Record<string, number> } = {},
): Promise<PlannedRound> {
  await actAs(client, actor);
  const { rows } = await client.query("select public.round_save($1::jsonb) as id", [
    JSON.stringify({ name: `Round ${prefix}`, batch_id: batch, sending_month: "2026-11-01", ref_prefix: prefix, default_cod: 500 }),
  ]);
  const round = rows[0].id as string;
  const codes = opts.tutes ?? ["T05", "T06"];
  await client.query("select public.round_set_tutes($1, $2::jsonb)", [
    round,
    JSON.stringify(codes.map((c) => ({ manual_title: `Tute ${c}`, short_code: c }))),
  ]);
  const tutes = (
    await client.query("select id from public.round_tutes where round_id = $1 order by sort_order", [round])
  ).rows.map((r) => r.id as string);
  await client.query("select public.round_set_students($1, $2::jsonb)", [
    round,
    JSON.stringify(
      students.map((s) => ({
        student_id: s,
        cod_amount: opts.cod?.[s] ?? null,
        excluded_tute_ids: (opts.excluded?.[s] ?? []).map((i) => tutes[i]),
      })),
    ),
  ]);
  return { round, tutes };
}

/** Record a tracking sheet for a round (as `actor`, who needs courier). */
export async function trackingFile(client: pg.Client, actor: Actor, round: string, sha = "e"): Promise<string> {
  await actAs(client, actor);
  const { rows } = await client.query(
    "select public.carrier_file_record($1, 'tracking_sheet', $2, 'citypak.xlsx', repeat($3, 64), 100, 2, '{}'::jsonb) as id",
    [round, `rounds/${round}/${crypto.randomUUID()}.xlsx`, sha],
  );
  return rows[0].id;
}

export type ReadyParcel = { id: string; reference: string; tracking: string; items: string[]; row_version: number };

// Random block per test file so tracking numbers never clash across files sharing one database.
let trackingSeq = 10000000 + Math.floor(Math.random() * 800) * 100000;

/** A finalised round whose parcels all have tracking numbers (ready to pack). Runs as `actor`. */
export async function readyRound(
  client: pg.Client,
  actor: Actor,
  batch: string,
  prefix: string,
  count: number,
): Promise<{ round: string; parcels: ReadyParcel[] }> {
  const numbers = Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
  const students = await seedStudents(client, batch, numbers);
  const { round } = await planRound(client, actor, batch, prefix, students);
  await actAs(client, actor);
  await client.query("select public.round_finalise($1)", [round]);
  const file = await trackingFile(client, actor, round, (trackingSeq % 9).toString());
  const refs = (await client.query("select reference from public.parcels where round_id = $1 order by reference", [round])).rows;
  const rows = refs.map((r) => ({ reference: r.reference, tracking_no: `D${trackingSeq++}` }));
  await client.query("select public.tracking_apply($1, $2, $3::jsonb)", [round, file, JSON.stringify(rows)]);
  await asOwner(client);
  const parcels = (
    await client.query(
      `select p.id, p.reference, p.tracking_no as tracking, p.row_version,
              array(select round_tute_id from public.parcel_items i where i.parcel_id = p.id order by round_tute_id)::text[] as items
         from public.parcels p where p.round_id = $1 order by p.reference`,
      [round],
    )
  ).rows as ReadyParcel[];
  return { round, parcels };
}

/**
 * A round whose parcels are packed (by `packer`) and verified (by `verifier`),
 * so they are ready to give to the courier. Runs as owner at the end.
 */
export async function verifiedRound(
  client: pg.Client,
  packer: Actor,
  verifier: Actor,
  batch: string,
  prefix: string,
  count: number,
): Promise<{ round: string; parcels: ReadyParcel[] }> {
  const { round, parcels } = await readyRound(client, packer, batch, prefix, count);
  for (const action of ["pack", "verify"] as const) {
    for (const p of parcels) {
      await asOwner(client);
      p.row_version = (await client.query("select row_version from public.parcels where id = $1", [p.id])).rows[0].row_version;
      await actAs(client, action === "pack" ? packer : verifier);
      const r = await client.query("select public.parcel_scan_confirm($1, $2, gen_random_uuid(), $3, $4::uuid[]) as r", [
        p.id,
        action,
        p.row_version,
        p.items,
      ]);
      if (r.rows[0].r.result !== "ok") throw new Error(`${action} ${p.reference}: ${r.rows[0].r.message}`);
    }
  }
  await asOwner(client);
  for (const p of parcels) {
    p.row_version = (await client.query("select row_version from public.parcels where id = $1", [p.id])).rows[0].row_version;
  }
  return { round, parcels };
}

/** Open a handover, scan the parcels in and confirm them (as `verifier`). Returns the handover id. */
export async function handOver(client: pg.Client, verifier: Actor, round: string, parcels: ReadyParcel[]): Promise<string> {
  await actAs(client, verifier);
  const hid = (await client.query("select public.handover_open($1) as id", [round])).rows[0].id as string;
  for (const p of parcels) await client.query("select public.handover_scan($1, $2)", [hid, p.tracking]);
  await client.query("select public.handover_confirm($1, $2, 'Rep', 'REF1', '')", [hid, parcels.length]);
  await asOwner(client);
  return hid;
}

/** A round whose parcels were handed over and marked delivered (COD 500 each). Runs as owner at the end. */
export async function deliveredRound(
  client: pg.Client,
  main: Actor,
  verifier: Actor,
  batch: string,
  prefix: string,
  count: number,
): Promise<{ round: string; parcels: ReadyParcel[] }> {
  const r = await verifiedRound(client, main, verifier, batch, prefix, count);
  await handOver(client, verifier, r.round, r.parcels);
  await actAs(client, main);
  await client.query("select public.delivery_set($1::uuid[], 'delivered', '')", [r.parcels.map((p) => p.id)]);
  await asOwner(client);
  return r;
}

/** Record and confirm a settlement paying `rows` (code, collected?, fee?) with `remitted`. Returns its id. */
export async function settle(
  client: pg.Client,
  finance: Actor,
  reference: string,
  rows: { code: string; collected?: number; fee?: number }[],
  remitted: number,
  dispute?: string,
): Promise<string> {
  await actAs(client, finance);
  const id = (
    await client.query("select public.settlement_save(null, $1::jsonb) as id", [
      JSON.stringify({ reference, settled_on: "2026-11-20", remitted }),
    ])
  ).rows[0].id as string;
  await client.query("select public.settlement_add_lines($1, $2::jsonb)", [id, JSON.stringify(rows)]);
  await client.query("select public.settlement_confirm($1, $2)", [id, dispute ?? null]);
  await asOwner(client);
  return id;
}
