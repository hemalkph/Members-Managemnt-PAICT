"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, MessageSquareTextIcon, SendIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import AnimatedList from "@/components/reactbits/animated-list";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addPaperNoteAction, deletePaperNoteAction } from "@/lib/actions/papers";

export type NoteItem = {
  id: string;
  author: string;
  stageLabel: string | null;
  body: string;
  /** Pre-formatted on the server. */
  when: string;
  canDelete: boolean;
  mine: boolean;
};

const NONE = "none";
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** Write a correction or note. With `fixedStage` it is the reviewer's form inside "Your part". */
export function NoteForm({
  paperId,
  stages,
  defaultStage,
  fixedStage,
  placeholder = "e.g. Q12: the answer should be (3). Page 4: fix the diagram labels.",
  submitLabel = "Send",
}: {
  paperId: string;
  stages?: { stage: string; label: string }[];
  defaultStage?: string;
  fixedStage?: string;
  placeholder?: string;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [stage, setStage] = useState(fixedStage ?? defaultStage ?? "");
  const [pending, startTransition] = useTransition();

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await addPaperNoteAction({ paper_id: paperId, stage: fixedStage ?? stage, body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setBody("");
      router.refresh();
    });
  };

  return (
    <form onSubmit={send} className="space-y-2">
      <Textarea
        rows={3}
        maxLength={3000}
        value={body}
        placeholder={placeholder}
        aria-label="Correction or note"
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!fixedStage && stages && stages.length > 0 ? (
          <Select value={stage || NONE} onValueChange={(v) => setStage(v === NONE ? "" : v)}>
            <SelectTrigger className="w-56" aria-label="About which stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>General note</SelectItem>
              {stages.map((s) => (
                <SelectItem key={s.stage} value={s.stage}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-muted-foreground text-xs">The type setter gets an alert.</span>
        )}
        <Button type="submit" size="sm" disabled={pending || body.trim().length === 0}>
          {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** All corrections and notes on a paper – reviews happen here instead of WhatsApp. */
export function PaperNotes({
  paperId,
  notes,
  stages,
  defaultStage,
  canWrite,
}: {
  paperId: string;
  notes: NoteItem[];
  stages: { stage: string; label: string }[];
  defaultStage?: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deletePaperNoteAction({ id, paper_id: paperId });
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });

  return (
    <Card id="notes" className="scroll-mt-20 gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareTextIcon className="text-primary size-5" /> Corrections &amp; notes
          {notes.length > 0 && <Badge variant="secondary">{notes.length}</Badge>}
        </CardTitle>
        <CardDescription>
          Reviewers write their corrections here; the type setter fixes them before hand-over. Everyone on this paper
          can read and add notes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No corrections yet.</p>
        ) : (
          <AnimatedList
            items={notes.map((n) => ({
              key: n.id,
              node: (
                <div className="flex gap-3 rounded-xl border p-3">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                      {initials(n.author)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-medium">{n.mine ? "You" : n.author}</span>
                      {n.stageLabel && <Badge variant="outline">{n.stageLabel}</Badge>}
                      <span className="text-muted-foreground text-xs">{n.when}</span>
                    </p>
                    <p className="text-sm whitespace-pre-line">{n.body}</p>
                  </div>
                  {n.canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground -mt-1 -mr-1 shrink-0"
                      aria-label="Remove note"
                      disabled={pending}
                      onClick={() => remove(n.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  )}
                </div>
              ),
            }))}
          />
        )}
        {canWrite && <NoteForm paperId={paperId} stages={stages} defaultStage={defaultStage} />}
      </CardContent>
    </Card>
  );
}
