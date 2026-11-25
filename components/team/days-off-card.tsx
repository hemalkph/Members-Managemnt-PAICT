"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarOffIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDayOffAction, deleteDayOffAction } from "@/lib/actions/days-off";
import { shortRange, type DayOff } from "@/lib/team/availability";

/** Your days away (and, for admins, everyone's): whoever assigns work sees them and is warned. */
export function DaysOffCard({
  daysOff,
  me,
  isAdmin,
  team,
  today,
}: {
  daysOff: DayOff[];
  me: string;
  isAdmin: boolean;
  team: { id: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [note, setNote] = useState("");
  const [forId, setForId] = useState(me);
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);
  const nameOf = (id: string) => (id === me ? "You" : (team.find((p) => p.id === id)?.name ?? "A member"));
  const shown = isAdmin ? daysOff : daysOff.filter((d) => d.userId === me);

  const add = () =>
    startTransition(async () => {
      const res = await addDayOffAction({
        from,
        to: to < from ? from : to,
        note,
        user_id: forId === me ? null : forId,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      setNote("");
      router.refresh();
    });

  const remove = (id: string) => {
    setRemoving(id);
    startTransition(async () => {
      const res = await deleteDayOffAction(id);
      setRemoving(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarOffIcon className="size-4" /> Days off
        </CardTitle>
        <CardDescription>
          Days you&apos;re away. Whoever gives out work sees them and is warned before setting a deadline on one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {shown.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {shown.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{shortRange(d.from, d.to)}</span>
                  {isAdmin && <span className="text-muted-foreground"> · {nameOf(d.userId)}</span>}
                  {d.note && <span className="text-muted-foreground block truncate text-xs">{d.note}</span>}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove days off ${shortRange(d.from, d.to)}`}
                  disabled={removing === d.id}
                  onClick={() => remove(d.id)}
                >
                  {removing === d.id ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {isAdmin && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="day-off-for">For</Label>
              <Select value={forId} onValueChange={setForId}>
                <SelectTrigger id="day-off-for" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={me}>Me</SelectItem>
                  {team
                    .filter((p) => p.id !== me)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="day-off-from">From</Label>
            <Input id="day-off-from" type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="day-off-to">To</Label>
            <Input
              id="day-off-to"
              type="date"
              min={from}
              value={to < from ? from : to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="day-off-note">Note (optional, only you and admins see it)</Label>
            <Input id="day-off-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <Button onClick={add} disabled={pending || !from}>
          {pending && !removing ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
          Add days off
        </Button>
      </CardContent>
    </Card>
  );
}
