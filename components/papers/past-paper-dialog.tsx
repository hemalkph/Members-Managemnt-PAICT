"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { HistoryIcon, Loader2Icon } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addPastPaperAction } from "@/lib/actions/papers";
import type { PastPaperInput } from "@/lib/core/validation";

const PARTS: { value: PastPaperInput["parts"]; label: string }[] = [
  { value: "split", label: "MCQ + SE & Essay" },
  { value: "mcq", label: "MCQ" },
  { value: "essay", label: "SE & Essay" },
  { value: "full", label: "Full paper" },
];

/**
 * Add a paper that was made and marked before the system, so the marking team
 * can log their marking for it. It is saved as finished: no stages, no tasks.
 */
export function PastPaperDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [parts, setParts] = useState<PastPaperInput["parts"]>("split");
  const [medium, setMedium] = useState<PastPaperInput["medium"]>("both");
  const [examDay, setExamDay] = useState("");
  const [pending, startTransition] = useTransition();

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await addPastPaperAction({ title, parts, medium, exam_day: examDay });
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      setOpen(false);
      setTitle("");
      setExamDay("");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <HistoryIcon /> Add a past paper
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a past paper</DialogTitle>
            <DialogDescription>
              For papers made and marked before this system. It&apos;s saved as finished and handed over, so the
              marking team can log their marking for it. Nobody is paid for making it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="past-title">Paper name</Label>
            <Input
              id="past-title"
              value={title}
              maxLength={130}
              placeholder="e.g. RFP 02"
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            {parts === "split" && title.trim() && (
              <p className="text-muted-foreground text-xs">
                Adds “{title.trim()} - MCQ” and “{title.trim()} - SE &amp; Essay”, marked as one set.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label>Parts</Label>
            <Tabs value={parts} onValueChange={(v) => setParts(v as PastPaperInput["parts"])}>
              {/* Two per row: "MCQ + SE & Essay" doesn't fit a quarter of the width. */}
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1">
                {PARTS.map((p) => (
                  <TabsTrigger key={p.value} value={p.value} className="h-8 px-3">
                    {p.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Medium</Label>
              <Tabs value={medium} onValueChange={(v) => setMedium(v as PastPaperInput["medium"])}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="si">Sinhala</TabsTrigger>
                  <TabsTrigger value="both">Both</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="past-day">Exam day (optional)</Label>
              <Input id="past-day" type="date" value={examDay} onChange={(e) => setExamDay(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || title.trim().length < 2}>
              {pending && <Loader2Icon className="animate-spin" />}
              {parts === "split" ? "Add both papers" : "Add paper"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
