import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ageOn, daysUntilBirthday } from "@/lib/birthday";
import type { Database } from "@/lib/database.types";

export type BirthdayPerson = {
  id: string;
  name: string;
  dateOfBirth: string;
  daysUntil: number;
  /** The age they turn on their next birthday. */
  turning: number;
};

/** Active members' birthdays within the next `withinDays` days (0 = today), soonest first. */
export async function getBirthdays(
  supabase: SupabaseClient<Database>,
  today: string,
  withinDays = 30,
): Promise<BirthdayPerson[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, date_of_birth")
    .eq("is_active", true)
    .not("date_of_birth", "is", null);

  return (data ?? [])
    .flatMap((p) => {
      if (!p.date_of_birth) return [];
      const daysUntil = daysUntilBirthday(p.date_of_birth, today);
      if (daysUntil > withinDays) return [];
      const ageNow = ageOn(p.date_of_birth, today);
      return [
        {
          id: p.id,
          name: p.full_name || p.email,
          dateOfBirth: p.date_of_birth,
          daysUntil,
          turning: daysUntil === 0 ? ageNow : ageNow + 1,
        },
      ];
    })
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
}
