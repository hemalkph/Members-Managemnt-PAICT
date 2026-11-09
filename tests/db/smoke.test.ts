import { expect, test } from "vitest";
import { session } from "./helpers";

test("every migration loads on the isolated database", async () => {
  const db = await session();
  const { rows } = await db.query(
    `select count(*) filter (where tablename = 'task_types')::int as late,
            count(*) filter (where tablename in ('students', 'parcels', 'dispatch_rounds'))::int as dispatch
       from pg_tables where schemaname = 'public'`,
  );
  // task_types comes from a late migration; Tute dispatch was removed in 045.
  expect(rows[0]).toEqual({ late: 1, dispatch: 0 });
  await db.end();
});
