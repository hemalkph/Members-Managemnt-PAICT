import { expect, test } from "vitest";
import { session } from "./helpers";

test("nic_birth_date rejects years before 1900 or after 2100", async () => {
  const db = await session();
  const { rows } = await db.query(
    `select
       public.nic_birth_date('200212345678') as valid_new,
       public.nic_birth_date('991234567V') as valid_old,
       public.nic_birth_date('000212345678') as year_two,
       public.nic_birth_date('000012345678') as year_zero,
       public.nic_birth_date('189912345678') as year_1899,
       public.nic_birth_date('210112345678') as year_2101`,
  );
  expect(rows[0].valid_new).toBeTruthy();
  expect(rows[0].valid_old).toBeTruthy();
  expect(rows[0].year_two).toBeNull();
  expect(rows[0].year_zero).toBeNull();
  expect(rows[0].year_1899).toBeNull();
  expect(rows[0].year_2101).toBeNull();
  await db.end();
});
