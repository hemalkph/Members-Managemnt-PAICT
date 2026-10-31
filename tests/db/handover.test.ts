// Handover to the courier, delivery states, voiding and replacement parcels.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { handOver, readyRound, trackingFile, verifiedRound, type ReadyParcel } from "./dispatch-fixtures";

let db: pg.Client;
let main: Actor;
let verifier: Actor;
let courier: Actor;
let batch = "";

beforeAll(async () => {
  db = await session();
  const edit = { dispatch: "edit" as const };
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true, name: "Main Admin" }), aal: "aal2" };
  verifier = { kind: "user", id: await createPerson(db, { pageAccess: edit, grants: ["verify"], name: "Vera Verifier" }), aal: "aal2" };
  courier = { kind: "user", id: await createPerson(db, { pageAccess: edit, grants: ["courier"], name: "Cora Courier" }), aal: "aal2" };
  batch = await createBatch(db);
});
afterAll(() => db.end());

const one = async (actor: Actor, sql: string, params: unknown[] = []) => {
  await actAs(db, actor);
  return (await db.query(sql, params)).rows[0];
};
const open = (round: string) => one(verifier, "select public.handover_open($1) as id", [round]).then((r) => r.id as string);
const scan = (h: string, code: string) => one(verifier, "select public.handover_scan($1, $2) as r", [h, code]).then((r) => r.r);
const confirm = (h: string, counted: number) => one(verifier, "select public.handover_confirm($1, $2, 'Nimal', 'CP-77', 'gate') as n", [h, counted]);
const parcel = async (id: string) => {
  await asOwner(db);
  return (await db.query("select * from public.parcels where id = $1", [id])).rows[0];
};
const deliver = (actor: Actor, ids: string[], state: string, reason = "") =>
  one(actor, "select public.delivery_set($1::uuid[], $2, $3) as r", [ids, state, reason]).then((r) => r.r);

describe("handover scanning", () => {
  let round = "";
  let parcels: ReadyParcel[] = [];
  let h = "";
  beforeAll(async () => {
    ({ round, parcels } = await verifiedRound(db, main, verifier, batch, "HNDSCAN", 4));
    h = await open(round);
  });

  test("opening again returns the same open handover", async () => {
    expect(await open(round)).toBe(h);
  });

  test("adds a ready parcel by tracking number or reference, once", async () => {
    expect(await scan(h, parcels[0].tracking.toLowerCase())).toMatchObject({ result: "ok", reference: parcels[0].reference });
    expect(await scan(h, parcels[1].reference)).toMatchObject({ result: "ok" });
    expect((await scan(h, parcels[0].tracking)).result).toBe("duplicate");
  });

  test("refuses unknown codes, other rounds and parcels that aren't ready", async () => {
    expect((await scan(h, "NOPE")).result).toBe("unknown");
    const other = await readyRound(db, main, batch, "HNDOTHR", 1);
    expect((await scan(h, other.parcels[0].tracking)).result).toBe("wrong_round");
    // Packed only, verification on.
    const packedOnly = await readyRound(db, main, batch, "HNDPACK", 1);
    const p = packedOnly.parcels[0];
    await actAs(db, main);
    await db.query("select public.parcel_scan_confirm($1, 'pack', gen_random_uuid(), $2, $3::uuid[])", [p.id, p.row_version, p.items]);
    const ph = await open(packedOnly.round);
    expect(await scan(ph, p.tracking)).toMatchObject({ result: "not_ready", message: /not verified/ });
    // On hold.
    await one(verifier, "select public.exception_open($1, 'damaged', 'torn') as id", [parcels[3].id]);
    expect(await scan(h, parcels[3].tracking)).toMatchObject({ result: "not_ready", message: /on hold/ });
  });

  test("a released parcel can be scanned again", async () => {
    await one(verifier, "select public.handover_release($1, $2)", [h, parcels[1].id]);
    expect((await scan(h, parcels[1].tracking)).result).toBe("ok");
  });
});

describe("confirming a handover", () => {
  test("the counted number must equal the scanned number", async () => {
    const { round, parcels } = await verifiedRound(db, main, verifier, batch, "HNDCNT", 2);
    const h = await open(round);
    await expect(confirm(h, 0)).rejects.toMatchObject({ message: /Scan the parcels/ });
    await scan(h, parcels[0].tracking);
    await scan(h, parcels[1].tracking);
    await expect(confirm(h, 3)).rejects.toMatchObject({ message: /counted 3 but 2 were scanned/ });
    expect((await parcel(parcels[0].id)).delivery_state).toBe("awaiting_pickup");
  });

  test("moves the parcels to handed over (never delivered), once, and records who", async () => {
    const { round, parcels } = await verifiedRound(db, main, verifier, batch, "HNDOK", 3);
    const h = await open(round);
    await scan(h, parcels[0].tracking);
    await scan(h, parcels[1].tracking);
    expect((await confirm(h, 2)).n).toBe(2);
    const p0 = await parcel(parcels[0].id);
    expect(p0).toMatchObject({ delivery_state: "handed_over", handover_id: h });
    expect((await parcel(parcels[2].id)).delivery_state).toBe("awaiting_pickup");
    const row = (await db.query("select state, counted_count, courier_rep, courier_ref, confirmed_by from public.handovers where id = $1", [h])).rows[0];
    expect(row).toEqual({ state: "confirmed", counted_count: 2, courier_rep: "Nimal", courier_ref: "CP-77", confirmed_by: (verifier as { id: string }).id });
    expect((await db.query("select state from public.dispatch_rounds where id = $1", [round])).rows[0].state).toBe("active");
    await expect(confirm(h, 2)).rejects.toMatchObject({ message: /not open/ });

    // A second handover for the rest of the round; handed-over parcels can't be added.
    const h2 = await open(round);
    expect(h2).not.toBe(h);
    expect(await scan(h2, parcels[0].tracking)).toMatchObject({ result: "not_ready", message: /already handed over/ });
    expect((await scan(h2, parcels[2].tracking)).result).toBe("ok");
  });

  test("a parcel that went on hold after scanning blocks the confirm", async () => {
    const { round, parcels } = await verifiedRound(db, main, verifier, batch, "HNDHOLD", 1);
    const h = await open(round);
    await scan(h, parcels[0].tracking);
    await one(verifier, "select public.exception_open($1, 'missing_item', 'T06 ran out') as id", [parcels[0].id]);
    await expect(confirm(h, 1)).rejects.toMatchObject({ message: /on hold/ });
  });

  test("cancelling frees the parcels for a new handover", async () => {
    const { round, parcels } = await verifiedRound(db, main, verifier, batch, "HNDCANC", 1);
    const h = await open(round);
    await scan(h, parcels[0].tracking);
    await one(verifier, "select public.handover_cancel($1, 'courier did not come')", [h]);
    const h2 = await open(round);
    expect((await scan(h2, parcels[0].tracking)).result).toBe("ok");
    await expect(scan(h, parcels[0].tracking)).rejects.toMatchObject({ message: /not open/ });
  });

  test("a receipt file must belong to the round", async () => {
    const { round, parcels } = await verifiedRound(db, main, verifier, batch, "HNDRCPT", 1);
    const other = await verifiedRound(db, main, verifier, batch, "HNDRCP2", 1);
    await actAs(db, verifier);
    const receipt = (
      await db.query(
        "select public.carrier_file_record($1, 'handover_receipt', $2, 'receipt.jpg', repeat('a', 64), 100, null, '{}'::jsonb) as id",
        [other.round, `receipts/${other.round}/${crypto.randomUUID()}.jpg`],
      )
    ).rows[0].id;
    const h = await open(round);
    await scan(h, parcels[0].tracking);
    await expect(
      one(verifier, "select public.handover_confirm($1, 1, '', '', '', $2)", [h, receipt]),
    ).rejects.toMatchObject({ message: /Receipt file not found/ });
  });
});

describe("delivery states", () => {
  let parcels: ReadyParcel[] = [];
  beforeAll(async () => {
    const r = await verifiedRound(db, main, verifier, batch, "DLVR", 4);
    parcels = r.parcels;
    await handOver(db, verifier, r.round, parcels.slice(0, 3));
  });

  test("moves forward, skipping parcels not with the courier", async () => {
    const r = await deliver(courier, [parcels[0].id, parcels[3].id], "in_transit");
    expect(r.changed).toBe(1);
    expect(r.skipped).toEqual([{ reference: parcels[3].reference, state: "awaiting_pickup" }]);
    expect((await deliver(courier, [parcels[0].id], "delivered")).changed).toBe(1);
    const ev = (await db.query("select type, from_state, to_state, source from public.parcel_events where parcel_id = $1 and type like 'deliver%' order by id", [parcels[0].id])).rows;
    expect(ev).toEqual([
      { type: "delivery", from_state: "handed_over", to_state: "in_transit", source: "manual" },
      { type: "delivery", from_state: "in_transit", to_state: "delivered", source: "manual" },
    ]);
  });

  test("failed and returned need a reason", async () => {
    await expect(deliver(courier, [parcels[1].id], "failed")).rejects.toMatchObject({ message: /reason/ });
    expect((await deliver(courier, [parcels[1].id], "failed", "no one home")).changed).toBe(1);
    expect((await deliver(courier, [parcels[1].id], "returned", "came back")).changed).toBe(1);
  });

  test("changing a final state needs the correct permission and a reason", async () => {
    expect((await deliver(courier, [parcels[0].id], "returned", "wrong")).changed).toBe(0);
    expect((await deliver(main, [parcels[0].id], "returned", "marked by mistake")).changed).toBe(1);
    const last = (await db.query("select type from public.parcel_events where parcel_id = $1 order by id desc limit 1", [parcels[0].id])).rows[0];
    expect(last.type).toBe("delivery_corrected");
  });
});

describe("void and send again", () => {
  test("a parcel with the courier can't be voided until it fails or comes back", async () => {
    const { round, parcels } = await verifiedRound(db, main, verifier, batch, "VOID", 2);
    await handOver(db, verifier, round, [parcels[0]]);
    await expect(one(main, "select public.parcel_void($1, 'lost')", [parcels[0].id])).rejects.toMatchObject({ message: /failed or came back/ });
    await expect(one(courier, "select public.parcel_void($1, 'lost')", [parcels[1].id])).rejects.toMatchObject({ code: "42501" });
    // In an open handover.
    const h = await open(round);
    await scan(h, parcels[1].tracking);
    await expect(one(main, "select public.parcel_void($1, 'wrong address')", [parcels[1].id])).rejects.toMatchObject({ message: /open handover/ });
    await one(verifier, "select public.handover_release($1, $2)", [h, parcels[1].id]);
    await one(main, "select public.parcel_void($1, 'wrong address')", [parcels[1].id]);
    expect((await parcel(parcels[1].id)).registration_state).toBe("voided");
  });

  test("a returned parcel is replaced with R1 carrying the same tutes, then R2", async () => {
    const { round, parcels } = await verifiedRound(db, main, verifier, batch, "RSHIP", 1);
    await handOver(db, verifier, round, parcels);
    await deliver(courier, [parcels[0].id], "returned", "wrong address");
    await one(verifier, "select public.exception_open($1, 'other', 'returned') as id", [parcels[0].id]);

    const r1 = (await one(main, "select public.parcel_replace($1, 'new address', $2::jsonb) as id", [
      parcels[0].id,
      JSON.stringify({ recipient: { address_line1: "9 New Lane", city: "Galle" }, cod_expected: 0 }),
    ])).id;
    const np = await parcel(r1);
    expect(np).toMatchObject({
      reference: `${parcels[0].reference}R1`,
      replaces_parcel_id: parcels[0].id,
      registration_state: "unregistered",
      pack_state: "planned",
      delivery_state: "awaiting_pickup",
      cod_expected: "0.00",
    });
    const rec = (await db.query("select name, address_line1, city, phone1 from public.parcel_recipients where parcel_id = $1", [r1])).rows[0];
    expect(rec).toMatchObject({ address_line1: "9 New Lane", city: "Galle", phone1: "0771234567" });
    const items = (await db.query("select count(*)::int as n from public.parcel_items where parcel_id = $1", [r1])).rows[0].n;
    expect(items).toBe(2);
    const old = await parcel(parcels[0].id);
    expect(old).toMatchObject({ registration_state: "voided", on_hold: false });
    expect((await db.query("select resolution from public.parcel_exceptions where parcel_id = $1", [parcels[0].id])).rows[0].resolution).toBe("reship");
    await expect(one(main, "select public.parcel_replace($1, 'again', '{}'::jsonb)", [parcels[0].id])).rejects.toMatchObject({ message: /already replaced/ });

    // The replacement gets its tracking number from the next Citypak sheet.
    const file = await trackingFile(db, main, round, "7");
    await one(main, "select public.tracking_apply($1, $2, $3::jsonb)", [round, file, JSON.stringify([{ reference: np.reference, tracking_no: "D99887766" }])]);
    expect((await parcel(r1)).registration_state).toBe("registered");

    // Replacing R1 gives R2 (from the first reference, not R1R1).
    const r2 = (await one(main, "select public.parcel_replace($1, 'lost again', '{}'::jsonb) as id", [r1])).id;
    expect((await parcel(r2)).reference).toBe(`${parcels[0].reference}R2`);
  });
});
