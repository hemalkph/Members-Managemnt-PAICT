import { MessageCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { whatsAppLink } from "@/lib/tasks/whatsapp";

export type LibraryContact = {
  userId: string;
  name: string;
  /** wa.me number (94…), or null when the member has none. */
  number: string | null;
  job: "print" | "lms";
};

const JOBS = [
  { job: "print", label: "Physical Coordinator – print", ask: "Please download it and send it for printing" },
  { job: "lms", label: "LMS Admin – add to LMS", ask: "Please download it and add it to the LMS" },
] as const;

/** Admins: one tap opens WhatsApp with a ready message about this paper. */
export function LibraryWhatsApp({
  contacts,
  paperTitle,
  files,
  url,
}: {
  contacts: LibraryContact[];
  paperTitle: string;
  /** What's in the library, e.g. "Sinhala, English". */
  files: string;
  url: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-7 bg-[#0f7a6e] px-2.5 text-white hover:bg-[#0c675d]" aria-label={`WhatsApp about ${paperTitle}`}>
          <MessageCircleIcon /> WhatsApp
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {JOBS.map(({ job, label, ask }, i) => {
          const people = contacts.filter((c) => c.job === job);
          return (
            <div key={job}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-muted-foreground text-xs">{label}</DropdownMenuLabel>
              {people.length === 0 ? (
                <DropdownMenuItem disabled>Nobody has this role yet</DropdownMenuItem>
              ) : (
                people.map((c) =>
                  c.number ? (
                    <DropdownMenuItem key={c.userId} asChild>
                      <a
                        href={whatsAppLink(
                          c.number,
                          `Hi ${c.name.split(" ")[0]}, "${paperTitle}" (${files}) is ready in the Paper library. ${ask}: ${url}`,
                        )}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {c.name}
                      </a>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem key={c.userId} disabled>
                      {c.name} – no WhatsApp number
                    </DropdownMenuItem>
                  ),
                )
              )}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
