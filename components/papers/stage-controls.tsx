"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckIcon, LinkIcon, Loader2Icon, PencilIcon, SkipForwardIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setPaperLinksAction, setStageLinkAction, updatePaperStageAction } from "@/lib/actions/papers";
import { setTaskStatusAction } from "@/lib/actions/tasks";
import type { ActionResult } from "@/lib/action-result";

const NONE = "none";

/** The stage owner finishes their stage (marks the stage task done). */
export function FinishStageButton({ taskId, label }: { taskId: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="success"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setTaskStatusAction({ id: taskId, status: "done" });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(`${label} done – the next stage has started`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
      Mark my stage done
    </Button>
  );
}

/** Admins: change owner / work days, skip, or mark a stage done. */
export function EditStageDialog({
  paperId,
  stageId,
  label,
  ownerId,
  startDate,
  dueDate,
  status,
  members,
}: {
  paperId: string;
  stageId: string;
  label: string;
  ownerId: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: "waiting" | "in_progress" | "done" | "skipped";
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState(ownerId ?? "");
  const [start, setStart] = useState(startDate ?? "");
  const [due, setDue] = useState(dueDate ?? "");
  const [pending, startTransition] = useTransition();

  const run = (action: "save" | "skip" | "done") =>
    startTransition(async () => {
      const result: ActionResult = await updatePaperStageAction({
        stage_id: stageId,
        paper_id: paperId,
        owner_id: owner,
        start_date: start,
        due_date: due,
        action,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOwner(ownerId ?? "");
          setStart(startDate ?? "");
          setDue(dueDate ?? "");
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PencilIcon /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {status === "skipped"
              ? "This stage is skipped. Choose an owner and save to bring it back."
              : "The owner gets this stage as a task when it starts."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run("save");
          }}
        >
          <div className="grid gap-2">
            <Label>Owner</Label>
            <Select value={owner || NONE} onValueChange={(v) => setOwner(v === NONE ? "" : v)}>
              <SelectTrigger aria-label="Owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No owner yet</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor={`start-${stageId}`}>Starts</Label>
              <Input id={`start-${stageId}`} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`due-${stageId}`}>Due</Label>
              <Input
                id={`due-${stageId}`}
                type="date"
                value={due}
                min={start || undefined}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex gap-2">
              {status !== "done" && status !== "skipped" && (
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run("skip")}>
                  <SkipForwardIcon /> Skip
                </Button>
              )}
              {status === "in_progress" && (
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run("done")}>
                  <CheckIcon /> Mark done
                </Button>
              )}
            </div>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The stage owner (or an admin) adds the link to their work, e.g. a Google Drive file. */
export function StageLinkDialog({
  paperId,
  stageId,
  label,
  link,
}: {
  paperId: string;
  stageId: string;
  label: string;
  link: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(link ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(link ?? "");
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={link ? "ghost" : "outline"}>
          <LinkIcon /> {link ? "Change link" : "Add link"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link for {label}</DialogTitle>
          <DialogDescription>
            Paste a share link to your file (Google Drive, OneDrive…). Files aren&apos;t uploaded here, so make sure the
            team can open the link.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await setStageLinkAction({ stage_id: stageId, link: value.trim(), paper_id: paperId });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success(result.message);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`link-${stageId}`}>Link</Label>
            <Input
              id={`link-${stageId}`}
              type="url"
              inputMode="url"
              placeholder="https://drive.google.com/…"
              value={value}
              maxLength={500}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            {link && (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setValue("")}>
                Clear
              </Button>
            )}
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Save link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Admins: the WhatsApp message links for the LMS admin and physical coordinator groups. */
export function HandoverLinksForm({
  paperId,
  lmsLink,
  physicalLink,
}: {
  paperId: string;
  lmsLink: string | null;
  physicalLink: string | null;
}) {
  const router = useRouter();
  const [lms, setLms] = useState(lmsLink ?? "");
  const [physical, setPhysical] = useState(physicalLink ?? "");
  const [pending, startTransition] = useTransition();
  const changed = lms.trim() !== (lmsLink ?? "") || physical.trim() !== (physicalLink ?? "");

  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await setPaperLinksAction({
            paper_id: paperId,
            lms_link: lms.trim(),
            physical_link: physical.trim(),
          });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="lms-link">LMS admin group</Label>
        <Input
          id="lms-link"
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={lms}
          maxLength={500}
          onChange={(e) => setLms(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="physical-link">Physical coordinator group</Label>
        <Input
          id="physical-link"
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={physical}
          maxLength={500}
          onChange={(e) => setPhysical(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending || !changed}>
        {pending && <Loader2Icon className="animate-spin" />}
        Save links
      </Button>
    </form>
  );
}
