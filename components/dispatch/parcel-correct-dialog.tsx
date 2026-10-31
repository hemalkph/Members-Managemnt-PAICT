"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { correctParcelAction } from "@/lib/actions/dispatch-rounds";

export type CorrectableParcel = {
  id: string;
  reference: string;
  rowVersion: number;
  cod: number;
  tuteIds: string[];
  recipient: { name: string; address_line1: string; address_line2: string; address_line3: string; city: string; phone1: string; phone2: string };
};

/** Fix a parcel before Citypak registers it. Every correction needs a reason and is recorded. */
export function ParcelCorrectDialog({
  parcel,
  tutes,
  children,
}: {
  parcel: CorrectableParcel;
  tutes: { id: string; code: string }[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [recipient, setRecipient] = useState(parcel.recipient);
  const [cod, setCod] = useState(String(parcel.cod));
  const [tuteIds, setTuteIds] = useState(parcel.tuteIds);
  const [reason, setReason] = useState("");

  const save = () =>
    startTransition(async () => {
      const result = await correctParcelAction({
        parcel_id: parcel.id,
        row_version: parcel.rowVersion,
        reason,
        cod_expected: cod,
        tute_ids: tuteIds,
        recipient,
      });
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });

  const field = (key: keyof CorrectableParcel["recipient"], label: string, wide = false) => (
    <div className={`grid gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={`c-${key}`}>{label}</Label>
      <Input id={`c-${key}`} value={recipient[key]} onChange={(e) => setRecipient((r) => ({ ...r, [key]: e.target.value }))} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Correct {parcel.reference}</DialogTitle>
          <DialogDescription>Allowed until Citypak gives this parcel a tracking number. Export the manifest again afterwards.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("name", "Name", true)}
          {field("address_line1", "Address line 1", true)}
          {field("address_line2", "Address line 2")}
          {field("address_line3", "Address line 3")}
          {field("city", "City")}
          {field("phone1", "Phone 1")}
          <div className="grid gap-1.5">
            <Label htmlFor="c-cod">COD (Rs.)</Label>
            <Input id="c-cod" type="number" min={0} value={cod} onChange={(e) => setCod(e.target.value)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Tutes in this parcel</Label>
            <div className="flex flex-wrap gap-3">
              {tutes.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={tuteIds.includes(t.id)}
                    onCheckedChange={(v) => setTuteIds((ids) => (v === true ? [...ids, t.id] : ids.filter((x) => x !== t.id)))}
                  />
                  <span className="font-mono">{t.code}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="c-reason">Reason</Label>
            <Input id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Student moved; new address by phone" maxLength={300} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || reason.trim().length < 3}>
            {pending && <Loader2Icon className="animate-spin" />} Save correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
