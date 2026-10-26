import Link from "next/link";
import { PartyPopperIcon } from "lucide-react";
import { ordinal } from "@/lib/birthday";
import type { BirthdayPerson } from "@/lib/birthday-queries";

/** Shown at the top of admin pages on someone's birthday. */
export function BirthdayBanner({ people }: { people: BirthdayPerson[] }) {
  if (people.length === 0) return null;
  return (
    <div
      role="status"
      className="from-primary/10 via-chart-2/10 to-chart-4/10 border-primary/20 mb-5 flex items-start gap-3 rounded-xl border bg-gradient-to-r p-4"
    >
      <span className="text-2xl leading-none" aria-hidden>
        🎂
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">
          {people.length === 1 ? "It's a team birthday today!" : `${people.length} team birthdays today!`}
        </p>
        <p className="text-muted-foreground">
          {people.map((p, i) => (
            <span key={p.id}>
              {i > 0 && (i === people.length - 1 ? " and " : ", ")}
              <Link href={`/admin/members/${p.id}`} className="text-foreground font-medium hover:underline">
                {p.name}
              </Link>{" "}
              ({ordinal(p.turning)})
            </span>
          ))}
          . Don&apos;t forget to celebrate!
        </p>
      </div>
      <PartyPopperIcon className="text-primary size-5 shrink-0" />
    </div>
  );
}
