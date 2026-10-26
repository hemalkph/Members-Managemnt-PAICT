import { MessageCircleIcon, PhoneOffIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type PaperContact = {
  userId: string;
  name: string;
  /** What they did on this paper, e.g. "Paper creator". */
  roles: string[];
  whatsapp: string | null;
};

/** A local number like 077 123 4567 → 94771234567 for wa.me links (Sri Lanka by default). */
export function waNumber(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("0")) digits = `94${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("7")) digits = `94${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/**
 * From the review stage on, files are not uploaded: the people working on the
 * paper talk on WhatsApp. One tap opens a chat with a ready-made message.
 */
export function ReviewContacts({
  contacts,
  paperTitle,
  paperUrl,
}: {
  contacts: PaperContact[];
  paperTitle: string;
  paperUrl: string;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircleIcon className="size-5 text-emerald-600 dark:text-emerald-400" /> Review on WhatsApp
        </CardTitle>
        <CardDescription>
          From the review stage, PDFs aren&apos;t uploaded here. Send the paper and your corrections straight to the
          creator, converter and type setter.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {contacts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No one else is working on this paper yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {contacts.map((c) => {
              const number = waNumber(c.whatsapp);
              const text = `Hi ${c.name.split(" ")[0]}, about the paper "${paperTitle}" – review: ${paperUrl}`;
              return (
                <li key={c.userId} className="flex items-center gap-3 rounded-xl border p-3">
                  <Avatar className="size-9">
                    <AvatarFallback className="bg-emerald-500/10 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      {initials(c.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-muted-foreground truncate text-xs">{c.roles.join(" · ")}</p>
                  </div>
                  {number ? (
                    <Button asChild size="sm" className="bg-[#0f7a6e] text-white hover:bg-[#0c675d]">
                      <a
                        href={`https://wa.me/${number}?text=${encodeURIComponent(text)}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Message ${c.name} on WhatsApp`}
                      >
                        <MessageCircleIcon /> Chat
                      </a>
                    </Button>
                  ) : (
                    <span
                      className="text-muted-foreground flex items-center gap-1 text-xs"
                      title="Ask them to add a WhatsApp number in their profile"
                    >
                      <PhoneOffIcon className="size-3.5" /> No number
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
