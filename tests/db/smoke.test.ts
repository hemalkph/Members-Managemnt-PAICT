import { expect, test } from "vitest";
import { session } from "./helpers";

test("every migration loads on the isolated database", async () => {
  const db = await session();
  const { rows } = await db.query("select count(*)::int as n from pg_tables where schemaname = 'public' and tablename = 'students'");
  expect(rows[0].n).toBe(1);
  await db.end();
});
