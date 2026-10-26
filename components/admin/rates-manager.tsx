"use client";

import { useMemo, useState, useTransition } from "react";
import { BriefcaseIcon, Loader2Icon, PlusIcon, RotateCcwIcon, SaveIcon, Trash2Icon, WalletIcon } from "lucide-react";
import { toast } from "sonner";

import { BrandLogo } from "@/components/brand-logo";
import { PhoneMockup } from "@/components/phone-mockup";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveRoleRatesAction } from "@/lib/actions/rates";
import { formatLKR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MAX_RATE } from "@/lib/validation";

export type RatesRole = {
  id: string;
  name: string;
  sectionName: string;
  is_salaried: boolean;
  items: { id: string; name: string; unit: string; price: number }[];
};

type DraftItem = { key: string; id?: string; name: string; unit: string; price: string };
type DraftRole = Omit<RatesRole, "items"> & { items: DraftItem[]; dirty: boolean };

const UNIT_SUGGESTIONS = ["page", "design", "paper", "scheme", "item"];

function toDraft(role: RatesRole): DraftRole {
  return {
    ...role,
    dirty: false,
    items: role.items.map((i) => ({ key: i.id, id: i.id, name: i.name, unit: i.unit, price: String(i.price) })),
  };
}

function priceOf(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function quantityOf(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function RatesManager({ roles: initialRoles }: { roles: RatesRole[] }) {
  const [roles, setRoles] = useState<DraftRole[]>(() => initialRoles.map(toDraft));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const updateRole = (roleId: string, change: (role: DraftRole) => DraftRole) =>
    setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...change(r), dirty: true } : r)));

  const updateItem = (roleId: string, key: string, patch: Partial<DraftItem>) =>
    updateRole(roleId, (r) => ({ ...r, items: r.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));

  const addItem = (roleId: string) =>
    updateRole(roleId, (r) => ({
      ...r,
      items: [...r.items, { key: crypto.randomUUID(), name: "", unit: r.items[0]?.unit ?? "item", price: "0" }],
    }));

  const removeItem = (roleId: string, key: string) =>
    updateRole(roleId, (r) => ({ ...r, items: r.items.filter((i) => i.key !== key) }));

  const save = (role: DraftRole) => {
    for (const item of role.items) {
      const price = Number(item.price);
      if (!item.name.trim()) return toast.error(`${role.name}: every item needs a name.`);
      if (!Number.isFinite(price) || price < 0 || price > MAX_RATE) {
        return toast.error(`${role.name}: “${item.name}” needs a valid price.`);
      }
    }
    setSavingId(role.id);
    startTransition(async () => {
      const result = await saveRoleRatesAction({
        role_id: role.id,
        is_salaried: role.is_salaried,
        items: role.items.map((i) => ({
          id: i.id,
          name: i.name.trim(),
          unit: i.unit.trim() || "item",
          price: Math.round(Number(i.price) * 100) / 100,
        })),
      });
      setSavingId(null);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Could not save." : result.error);
        return;
      }
      const saved = result.data.items;
      // Keep preview quantities: saved items come back in the same order.
      setQty((prev) => {
        const next = { ...prev };
        role.items.forEach((item, index) => {
          const newId = saved[index]?.id;
          if (newId && newId !== item.key && prev[item.key] !== undefined) {
            next[newId] = prev[item.key];
            delete next[item.key];
          }
        });
        return next;
      });
      setRoles((prev) =>
        prev.map((r) =>
          r.id === role.id
            ? {
                ...r,
                dirty: false,
                items: saved.map((s) => ({ key: s.id, id: s.id, name: s.name, unit: s.unit, price: String(s.price) })),
              }
            : r,
        ),
      );
      toast.success(`${role.name}: ${result.message}`);
    });
  };

  // Live budget preview: every item with a quantity, using the prices as typed (saved or not).
  const preview = useMemo(() => {
    const groups = roles
      .filter((r) => !r.is_salaried)
      .map((r) => {
        const lines = r.items
          .map((i) => {
            const quantity = quantityOf(qty[i.key]);
            const price = priceOf(i.price);
            return { key: i.key, name: i.name || "Untitled item", unit: i.unit || "item", quantity, price, total: quantity * price };
          })
          .filter((l) => l.quantity > 0);
        return { role: r, lines, subtotal: lines.reduce((s, l) => s + l.total, 0) };
      })
      .filter((g) => g.lines.length > 0);
    return { groups, total: groups.reduce((s, g) => s + g.subtotal, 0), units: groups.reduce((s, g) => s + g.lines.reduce((a, l) => a + l.quantity, 0), 0) };
  }, [roles, qty]);

  const sections = useMemo(() => {
    const map = new Map<string, DraftRole[]>();
    for (const r of roles) map.set(r.sectionName, [...(map.get(r.sectionName) ?? []), r]);
    return [...map.entries()];
  }, [roles]);

  const hasQty = Object.values(qty).some((v) => quantityOf(v) > 0);

  return (
    <div className="grid gap-6 pb-20 lg:grid-cols-[minmax(0,1fr)_320px] lg:pb-0 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* ------------------------------------------------ editor */}
      <div className="space-y-6">
        {sections.map(([section, sectionRoles]) => (
          <section key={section} className="space-y-3">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{section}</h2>
            {sectionRoles.map((role) => (
              <SpotlightCard key={role.id} className="overflow-visible">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{role.name}</h3>
                    {role.dirty && <Badge variant="warning">Unsaved</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`salaried-${role.id}`} className="text-muted-foreground text-sm font-normal">
                      Fixed salary
                    </Label>
                    <Switch
                      id={`salaried-${role.id}`}
                      checked={role.is_salaried}
                      onCheckedChange={(v) => updateRole(role.id, (r) => ({ ...r, is_salaried: v }))}
                    />
                  </div>
                </div>

                <div className="p-4">
                  {role.is_salaried ? (
                    <p className="text-muted-foreground flex items-center gap-2 text-sm">
                      <BriefcaseIcon className="size-4" /> Paid a fixed salary. No per-unit rates.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {role.items.length === 0 && (
                        <p className="text-muted-foreground text-sm">No rate categories yet. Add one below.</p>
                      )}
                      {role.items.length > 0 && (
                        <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_110px_140px_96px_36px] gap-2 text-xs font-medium sm:grid">
                          <span>Category</span>
                          <span>Per</span>
                          <span>Price (Rs.)</span>
                          <span>Preview qty</span>
                          <span />
                        </div>
                      )}
                      {role.items.map((item) => (
                        <div
                          key={item.key}
                          className="grid grid-cols-2 gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_110px_140px_96px_36px] sm:items-center sm:rounded-none sm:border-0 sm:p-0"
                        >
                          <Input
                            aria-label="Category name"
                            placeholder="e.g. Flyer"
                            className="col-span-2 sm:col-span-1"
                            value={item.name}
                            onChange={(e) => updateItem(role.id, item.key, { name: e.target.value })}
                          />
                          <Input
                            aria-label="Unit"
                            placeholder="page"
                            list="rate-units"
                            value={item.unit}
                            onChange={(e) => updateItem(role.id, item.key, { unit: e.target.value })}
                          />
                          <div className="relative">
                            <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs">
                              Rs.
                            </span>
                            <Input
                              aria-label="Price"
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="0.01"
                              className="pl-9 tabular-nums"
                              value={item.price}
                              onChange={(e) => updateItem(role.id, item.key, { price: e.target.value })}
                            />
                          </div>
                          <Input
                            aria-label="Quantity for preview"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            placeholder="Qty"
                            className="tabular-nums"
                            value={qty[item.key] ?? ""}
                            onChange={(e) => setQty((q) => ({ ...q, [item.key]: e.target.value }))}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive justify-self-end"
                            aria-label={`Remove ${item.name || "item"}`}
                            onClick={() => removeItem(role.id, item.key)}
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={() => addItem(role.id)}>
                        <PlusIcon /> Add category
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex justify-end border-t p-3">
                  <Button size="sm" onClick={() => save(role)} disabled={!role.dirty || savingId === role.id}>
                    {savingId === role.id ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                    Save {role.name}
                  </Button>
                </div>
              </SpotlightCard>
            ))}
          </section>
        ))}
        <datalist id="rate-units">
          {UNIT_SUGGESTIONS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </div>

      {/* ------------------------------------------------ live preview */}
      <aside id="budget-preview" className="scroll-mt-20 space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Live budget preview</h2>
          <Button variant="ghost" size="sm" disabled={!hasQty} onClick={() => setQty({})}>
            <RotateCcwIcon /> Clear qty
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Type prices and preview quantities in the rate list. The estimate updates as you type, even before saving.
        </p>
        <PhoneMockup>
          <div className="flex min-h-full flex-col gap-3 px-4 pb-4">
            <div className="flex items-center gap-2 pt-1">
              <BrandLogo className="h-6" />
              <div className="leading-tight">
                <p className="text-sm font-semibold">Budget estimate</p>
                <p className="text-muted-foreground text-[11px]">Team Work Tracker</p>
              </div>
            </div>

            <div className="from-primary to-chart-2 text-primary-foreground rounded-2xl bg-gradient-to-br p-4 shadow-md">
              <p className="text-xs opacity-90">Estimated total</p>
              <p className="text-2xl font-bold tracking-tight tabular-nums">{formatLKR(preview.total)}</p>
              <p className="text-[11px] opacity-90">
                {preview.units} unit{preview.units === 1 ? "" : "s"} · {preview.groups.length} role
                {preview.groups.length === 1 ? "" : "s"}
              </p>
            </div>

            {preview.groups.length === 0 ? (
              <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center text-xs">
                <WalletIcon className="size-8 opacity-50" />
                Enter a quantity next to any category to see the cost here.
              </div>
            ) : (
              <div className="space-y-3">
                {preview.groups.map((g) => (
                  <div key={g.role.id} className="bg-card rounded-xl border p-3 shadow-xs">
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <p className="truncate text-xs font-semibold">{g.role.name}</p>
                      <p className="text-xs font-semibold tabular-nums">{formatLKR(g.subtotal)}</p>
                    </div>
                    <ul className="space-y-1.5">
                      {g.lines.map((l) => (
                        <li key={l.key} className="flex items-start justify-between gap-2 text-[11px]">
                          <div className="min-w-0">
                            <p className="truncate">
                              {l.name} × {l.quantity}
                            </p>
                            <p className="text-muted-foreground">
                              {formatLKR(l.price)} / {l.unit}
                            </p>
                          </div>
                          <span className="shrink-0 tabular-nums">{formatLKR(l.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <p
              className={cn(
                "text-muted-foreground mt-auto text-center text-[10px]",
                roles.some((r) => r.dirty) && "text-amber-600 dark:text-amber-400",
              )}
            >
              {roles.some((r) => r.dirty) ? "Includes unsaved prices" : "Based on saved prices"}
            </p>
          </div>
        </PhoneMockup>
      </aside>

      {/* Phones: the preview is far below, so keep the total in view. */}
      {hasQty && (
        <div className="bg-background/95 fixed inset-x-3 bottom-3 z-30 flex items-center justify-between gap-3 rounded-xl border p-3 shadow-lg backdrop-blur lg:hidden">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">Estimated total</p>
            <p className="truncate font-semibold tabular-nums">{formatLKR(preview.total)}</p>
          </div>
          <Button size="sm" asChild>
            <a href="#budget-preview">View preview</a>
          </Button>
        </div>
      )}
    </div>
  );
}
