"use client";

import { useRef, useState } from "react";
import { BookmarkPlusIcon, Loader2Icon, XIcon, ZapIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";

/** Ready-made remarks everyone gets. Ones ending in "Q" are finished with a question number. */
const BUILT_IN = [
  "Diagram for Q",
  "Image for Q",
  "Fixed Q",
  "All corrections done",
  "Final, ready for type setting",
  "Draft, not final",
  "Answers included",
];

type Template = { id: string; body: string };

/**
 * A "Templates" button beside a remark box: tap a remark to add it, save the
 * current text as your own, or remove one. Each member's templates are their own.
 */
export function TextTemplates({
  value,
  onPick,
  disabled = false,
  focusId,
}: {
  value: string;
  onPick: (text: string) => void;
  disabled?: boolean;
  /** The remark box to return to after picking, e.g. to type the question number. */
  focusId?: string;
}) {
  const picked = useRef(false);
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<Template[] | null>(null);
  const [busy, setBusy] = useState(false);
  const current = value.trim();

  const load = async () => {
    const { data, error } = await createClient()
      .from("text_templates")
      .select("id, body")
      .order("created_at")
      .limit(30);
    if (error) toast.error("Could not load your templates.");
    setMine(data ?? []);
  };

  const pick = (text: string) => {
    // Add to what's already typed, so templates can be combined.
    onPick(current ? `${current}, ${text}`.slice(0, 300) : text);
    picked.current = true;
    setOpen(false);
  };

  const save = async () => {
    setBusy(true);
    const { data, error } = await createClient()
      .from("text_templates")
      .insert({ body: current })
      .select("id, body")
      .single();
    setBusy(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "You already have that template."
          : error.code === "42501"
            ? "You can keep up to 30 templates. Remove one first."
            : "Could not save the template.",
      );
      return;
    }
    setMine((m) => [...(m ?? []), data]);
    toast.success("Template saved");
  };

  const remove = async (t: Template) => {
    setMine((m) => (m ?? []).filter((x) => x.id !== t.id));
    const { error } = await createClient().from("text_templates").delete().eq("id", t.id);
    if (error) {
      toast.error("Could not remove the template.");
      void load();
    }
  };

  const chip =
    "bg-muted hover:bg-accent hover:text-accent-foreground max-w-full truncate rounded-md px-2 py-1 text-left text-xs font-medium transition-colors";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && mine === null) void load();
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" disabled={disabled}>
          <ZapIcon /> Templates
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 space-y-3"
        onCloseAutoFocus={(e) => {
          const box = focusId ? (document.getElementById(focusId) as HTMLInputElement | null) : null;
          if (!picked.current || !box) return;
          picked.current = false;
          e.preventDefault();
          box.focus();
          box.setSelectionRange(box.value.length, box.value.length);
        }}
      >
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Your templates</p>
          {mine === null ? (
            <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
          ) : mine.length === 0 ? (
            <p className="text-muted-foreground text-xs">None yet. Type a remark you use often, then save it here.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {mine.map((t) => (
                <span key={t.id} className="bg-muted inline-flex max-w-full items-center rounded-md">
                  <button type="button" className={`${chip} bg-transparent`} onClick={() => pick(t.body)}>
                    {t.body}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove template ${t.body}`}
                    className="text-muted-foreground hover:text-foreground pr-1.5"
                    onClick={() => void remove(t)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {current && !mine?.some((t) => t.body === current) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : <BookmarkPlusIcon />}
              Save &ldquo;{current.length > 28 ? `${current.slice(0, 28)}…` : current}&rdquo; as a template
            </Button>
          )}
        </div>
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-semibold">Common remarks</p>
          <div className="flex flex-wrap gap-1.5">
            {BUILT_IN.map((text) => (
              <button key={text} type="button" className={chip} onClick={() => pick(text)}>
                {text}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
