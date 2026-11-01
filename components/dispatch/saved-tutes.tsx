"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BookOpenIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { archiveSavedTuteAction, saveSavedTuteAction } from "@/lib/actions/dispatch-rounds";
import { useT } from "./lang";

export type StoredTute = {
  id: string;
  title: string;
  short_code: string;
  version_label: string;
  qty_per_parcel: number;
};

const BLANK = { id: "", title: "", short_code: "", version_label: "", qty_per_parcel: 1 };

/** Tutes added ahead of time, ready to pick when a round is planned. */
export function SavedTutes({ tutes }: { tutes: StoredTute[] }) {
  const t = useT();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [form, setForm] = useState<StoredTute>(BLANK);
  const [pending, startTransition] = useTransition();
  const editing = form.id !== "";

  const save = () =>
    startTransition(async () => {
      const result = await saveSavedTuteAction(form);
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      setForm(BLANK);
      router.refresh();
    });

  const remove = (tute: StoredTute) =>
    startTransition(async () => {
      const result = await archiveSavedTuteAction({ id: tute.id });
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      if (form.id === tute.id) setForm(BLANK);
      router.refresh();
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="h-fit shadow-sm lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>{editing ? t("Edit tute") : t("Add a tute")}</CardTitle>
          <CardDescription>{t("Rounds keep their own copy, so editing here never changes a round.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="saved-title">{t("Title")}</Label>
              <Input
                id="saved-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={t("Tute 05 – Networking")}
                maxLength={150}
                required
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="saved-code">{t("Short code")}</Label>
                <Input
                  id="saved-code"
                  value={form.short_code}
                  onChange={(e) => setForm({ ...form, short_code: e.target.value.toUpperCase() })}
                  placeholder="T05"
                  className="font-mono"
                  maxLength={10}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="saved-version">{t("Version")}</Label>
                <Input
                  id="saved-version"
                  value={form.version_label}
                  onChange={(e) => setForm({ ...form, version_label: e.target.value })}
                  placeholder="v1"
                  maxLength={30}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="saved-qty">{t("Copies")}</Label>
                <Input
                  id="saved-qty"
                  type="number"
                  min={1}
                  max={10}
                  value={form.qty_per_parcel}
                  onChange={(e) => setForm({ ...form, qty_per_parcel: Number(e.target.value) || 1 })}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending} className="flex-1">
                {pending ? <Loader2Icon className="animate-spin" /> : editing ? <PencilIcon /> : <PlusIcon />}
                {editing ? t("Save tute") : t("Add tute")}
              </Button>
              {editing && (
                <Button type="button" variant="outline" onClick={() => setForm(BLANK)}>
                  <XIcon /> {t("Cancel")}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {tutes.length === 0 ? (
        <EmptyState
          icon={BookOpenIcon}
          title={t("No saved tutes yet")}
          description={t("Add each tute once. It will be ready to pick in every round.")}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {tutes.map((tute) => (
              <motion.li
                key={tute.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? undefined : { opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2 }}
                className="bg-card group relative flex flex-col gap-2 rounded-xl border p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 font-mono text-sm font-semibold">
                    {tute.short_code}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Edit {code}", { code: tute.short_code })}
                      onClick={() => setForm(tute)}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Remove {code}", { code: tute.short_code })}
                      onClick={() => remove(tute)}
                      disabled={pending}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>
                <p className="leading-snug font-medium">{tute.title}</p>
                <div className="text-muted-foreground mt-auto flex flex-wrap gap-1.5 text-xs">
                  {tute.version_label && <Badge variant="secondary">{tute.version_label}</Badge>}
                  <Badge variant="outline">
                    {t("{n} per parcel", { n: tute.qty_per_parcel })}
                  </Badge>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
