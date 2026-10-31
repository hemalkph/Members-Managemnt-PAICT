// Rules of dispatch rounds: planning, finalising (frozen manifest, fixed
// references), corrections before registration, tracking numbers and history.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { planRound, seedStudents, trackingFile } from "./dispatch-fixtures";

let db: pg.Client;
let main: Actor;
let viewer: Actor;
let batch = "";

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  viewer = {
    kind: "user",
    id: await createPerson(db, { pageAccess: { dispatch: "view" } }),
    aal: "aal2",
  };
  batch = await createBatch(db);
});
afterAll(() => db.end());

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

describe("finalising", () => {
  test("creates one parcel per student with a fixed reference, frozen address, contents and COD", async () => {
    const [a, b] = await seedStudents(db, batch, ["088", "089"]);
    const { round, tutes } = await planRound(db, main, batch, "27TGNOVICT", [a, b], { excluded: { [b]: [1] }, cod: { [b]: 0 } });
    await actAs(db, main);
    expect((await q("select public.round_finalise($1) as n", [round]))[0].n).toBe(2);

    await asOwner(db);
    const parcels = await q(
      `select p.reference, p.cod_expected::text, p.registration_state, r.name, r.address_line1,
              (select array_agg(round_tute_id order by round_tute_id) from public.parcel_items i where i.parcel_id = p.id) as items
         from public.parcels p join public.parcel_recipients r on r.parcel_id = p.id
        where p.round_id = $1 order by p.reference`,
      [round],
    );
    expect(parcels.map((p) => p.reference)).toEqual(["27TGNOVICT088", "27TGNOVICT089"]);
    expect(parcels.map((p) => p.cod_expected)).toEqual(["500.00", "0.00"]);
    expect(parcels[0].items).toHaveLength(2);
    expect(parcels[1].items).toEqual([tutes[0]]);
    expect(parcels.every((p) => p.registration_state === "unregistered")).toBe(true);
    expect((await q("select state, manifest_version from public.dispatch_rounds where id = $1", [round]))[0]).toEqual({
      state: "finalised",
      manifest_version: 1,
    });
    expect((await q("select count(*)::int as n from public.parcel_events where round_id = $1 and type = 'created'", [round]))[0].n).toBe(2);

    // Later edits to the student never change the frozen parcel.
    await q("update public.students set address_line1 = 'Moved Away' where id = $1", [a]);
    expect((await q("select address_line1 from public.parcel_recipients r join public.parcels p on p.id = r.parcel_id where p.student_id = $1", [a]))[0].address_line1).toBe("088 Test Road");

    // The plan can no longer be edited.
    await actAs(db, main);
    await expect(db.query("select public.round_set_tutes($1, '[]'::jsonb)", [round])).rejects.toMatchObject({ code: "P0001" });
    await expect(db.query("select public.round_set_students($1, '[]'::jsonb)", [round])).rejects.toMatchObject({ code: "P0001" });
    await expect(db.query("select public.round_finalise($1)", [round])).rejects.toMatchObject({ code: "P0001" });
  });

  test.each([
    ["address", { address_line1: "" }, /address or city missing/],
    ["phone", { phone1: null }, /phone missing/],
  ] as const)("is blocked when a student's %s is missing, naming the student", async (_n, override, message) => {
    const [s] = await seedStudents(db, batch, [`M${Math.floor(Math.random() * 1e6)}`], override);
    const { round } = await planRound(db, main, batch, `MISS${Math.floor(Math.random() * 1e6)}`, [s]);
    await actAs(db, main);
    await expect(db.query("select public.round_finalise($1)", [round])).rejects.toMatchObject({ message });
    await asOwner(db);
    expect((await q("select count(*)::int as n from public.parcels where round_id = $1", [round]))[0].n).toBe(0);
  });

  test("a reference already used by another round blocks finalising (never reused)", async () => {
    const [s] = await seedStudents(db, batch, ["301"]);
    const first = await planRound(db, main, batch, "SAMEPFX", [s]);
    await actAs(db, main);
    await q("select public.round_finalise($1)", [first.round]);
    const second = await planRound(db, main, batch, "SAMEPFX", [s]);
    await actAs(db, main);
    await expect(db.query("select public.round_finalise($1)", [second.round])).rejects.toMatchObject({
      message: /SAMEPFX301 is already used/,
    });
  });

  test("a student with every tute removed blocks finalising", async () => {
    const [s] = await seedStudents(db, batch, ["401"]);
    const { round } = await planRound(db, main, batch, "EMPTYPFX", [s], { excluded: { [s]: [0, 1] } });
    await actAs(db, main);
    await expect(db.query("select public.round_finalise($1)", [round])).rejects.toMatchObject({ message: /no tutes/ });
  });

  test("only finished tutes can be picked from Papers", async () => {
    await asOwner(db);
    const [unfinished, done] = (
      await q(
        `insert into public.papers (title, kind, status) values ('Tute draft', 'tute', 'in_progress'), ('Tute final', 'tute', 'done')
         returning id`,
      )
    ).map((r) => r.id);
    await actAs(db, main);
    const round = (await q("select public.round_save($1::jsonb) as id", [
      JSON.stringify({ name: "Paper tutes", batch_id: batch, sending_month: "2026-11-01", ref_prefix: "PAPERPFX" }),
    ]))[0].id;
    await expect(
      db.query("select public.round_set_tutes($1, $2::jsonb)", [round, JSON.stringify([{ paper_id: unfinished, short_code: "T1" }])]),
    ).rejects.toMatchObject({ message: /finished/ });
    await q("select public.round_set_tutes($1, $2::jsonb)", [round, JSON.stringify([{ paper_id: done, short_code: "T1" }])]);
    expect((await q("select title from public.round_tutes where round_id = $1", [round]))[0].title).toBe("Tute final");
  });

  test("students from another batch can't be added", async () => {
    const other = await createBatch(db);
    const [s] = await seedStudents(db, other, ["501"]);
    await expect(planRound(db, main, batch, "OTHERPFX", [s])).rejects.toMatchObject({ message: /this round's batch/ });
  });
});

describe("corrections before registration", () => {
  test("need a reason and the current version; they bump the manifest and leave history", async () => {
    const [s] = await seedStudents(db, batch, ["601"]);
    const { round, tutes } = await planRound(db, main, batch, "CORRPFX", [s]);
    await actAs(db, main);
    await q("select public.round_finalise($1)", [round]);
    const parcel = (await q("select id, row_version from public.parcels where round_id = $1", [round]))[0];

    await expect(
      db.query("select public.parcel_correct($1, $2::jsonb, '', $3)", [parcel.id, JSON.stringify({ cod_expected: 0 }), parcel.row_version]),
    ).rejects.toMatchObject({ message: /reason/ });
    await expect(
      db.query("select public.parcel_correct($1, $2::jsonb, 'Paid already', 99)", [parcel.id, JSON.stringify({ cod_expected: 0 })]),
    ).rejects.toMatchObject({ message: /changed by someone else/ });

    await q("select public.parcel_correct($1, $2::jsonb, 'Paid already', $3)", [
      parcel.id,
      JSON.stringify({ cod_expected: 0, tute_ids: [tutes[0]] }),
      parcel.row_version,
    ]);
    await asOwner(db);
    const after = (await q("select cod_expected::text, row_version, manifest_version from public.parcels where id = $1", [parcel.id]))[0];
    expect(after).toEqual({ cod_expected: "0.00", row_version: 2, manifest_version: 2 });
    expect((await q("select count(*)::int as n from public.parcel_items where parcel_id = $1", [parcel.id]))[0].n).toBe(1);
    expect((await q("select reason from public.parcel_events where parcel_id = $1 and type = 'corrected'", [parcel.id]))[0].reason).toBe(
      "Paid already",
    );
  });

  test("are refused once the parcel is registered", async () => {
    const [s] = await seedStudents(db, batch, ["602"]);
    const { round } = await planRound(db, main, batch, "REGPFX", [s]);
    await actAs(db, main);
    await q("select public.round_finalise($1)", [round]);
    const file = await trackingFile(db, main, round);
    await q("select public.tracking_apply($1, $2, $3::jsonb)", [round, file, JSON.stringify([{ reference: "REGPFX602", tracking_no: "D90000001" }])]);
    const parcel = (await q("select id, row_version from public.parcels where round_id = $1", [round]))[0];
    await expect(
      db.query("select public.parcel_correct($1, $2::jsonb, 'Too late', $3)", [parcel.id, JSON.stringify({ cod_expected: 0 }), parcel.row_version]),
    ).rejects.toMatchObject({ message: /voided and replaced/ });
  });
});

describe("tracking numbers", () => {
  let round = "";
  let file = "";
  beforeAll(async () => {
    const students = await seedStudents(db, batch, ["701", "702", "703"]);
    round = (await planRound(db, main, batch, "TRKPFX", students)).round;
    await actAs(db, main);
    await q("select public.round_finalise($1)", [round]);
    file = await trackingFile(db, main, round, "f");
  });
  const apply = async (rows: { reference: string; tracking_no: string }[]) => {
    await actAs(db, main);
    return (await q("select public.tracking_apply($1, $2, $3::jsonb) as r", [round, file, JSON.stringify(rows)]))[0].r;
  };

  test("are applied, make the round active, and re-applying changes nothing", async () => {
    expect(await apply([{ reference: "TRKPFX701", tracking_no: "D80000001" }, { reference: "TRKPFX702", tracking_no: "D80000002" }])).toEqual({
      applied: 2,
      unchanged: 0,
    });
    expect(await apply([{ reference: "TRKPFX701", tracking_no: "D80000001" }])).toEqual({ applied: 0, unchanged: 1 });
    await asOwner(db);
    expect((await q("select state from public.dispatch_rounds where id = $1", [round]))[0].state).toBe("active");
    expect((await q("select count(*)::int as n from public.parcel_events where round_id = $1 and type = 'registered'", [round]))[0].n).toBe(2);
  });

  test("a different number for a registered parcel stops the whole import", async () => {
    await expect(
      apply([{ reference: "TRKPFX703", tracking_no: "D80000003" }, { reference: "TRKPFX701", tracking_no: "D89999999" }]),
    ).rejects.toMatchObject({ message: /already has tracking number/ });
    await asOwner(db);
    expect((await q("select tracking_no from public.parcels where reference = 'TRKPFX703'"))[0].tracking_no).toBeNull();
  });

  test("a number used by another parcel, or an unknown reference, is refused", async () => {
    await expect(apply([{ reference: "TRKPFX703", tracking_no: "D80000001" }])).rejects.toMatchObject({ message: /already used/ });
    await expect(apply([{ reference: "NOTHERE999", tracking_no: "D80000009" }])).rejects.toMatchObject({ message: /not in this round/ });
  });

  test("the same file recorded twice is one record", async () => {
    await actAs(db, main);
    const again = (
      await q("select public.carrier_file_record($1, 'tracking_sheet', $2, 'x.xlsx', repeat('f', 64), 100, 2, '{}'::jsonb) as id", [
        round,
        `rounds/${round}/${crypto.randomUUID()}.xlsx`,
      ])
    )[0].id;
    expect(again).toBe(file);
  });
});

describe("history and privacy", () => {
  test("parcel history cannot be changed or deleted, even by the database owner", async () => {
    await asOwner(db);
    await expect(db.query("update public.parcel_events set reason = 'x' where id = (select min(id) from public.parcel_events)")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(db.query("delete from public.parcel_events where id = (select min(id) from public.parcel_events)")).rejects.toMatchObject({
      code: "42501",
    });
  });

  test("view-only users see parcels and progress but no addresses, history or files", async () => {
    await actAs(db, viewer);
    expect((await q("select count(*)::int as n from public.parcels"))[0].n).toBeGreaterThan(0);
    expect((await q("select count(*)::int as n from public.dispatch_rounds"))[0].n).toBeGreaterThan(0);
    expect((await q("select count(*)::int as n from public.parcel_recipients"))[0].n).toBe(0);
    expect((await q("select count(*)::int as n from public.parcel_events"))[0].n).toBe(0);
    expect((await q("select count(*)::int as n from public.carrier_files"))[0].n).toBe(0);
    expect((await q("select count(*)::int as n from public.round_students"))[0].n).toBe(0);
  });
});
