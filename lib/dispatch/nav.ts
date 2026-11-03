// The Tute dispatch tabs each person sees, from their dispatch permissions.
import type { DispatchNavItem } from "@/components/dispatch/dispatch-nav";
import type { DispatchCapability } from "@/lib/database.types";

export function dispatchNavItems(caps: ReadonlySet<DispatchCapability>, isMainAdmin: boolean): DispatchNavItem[] {
  const items: DispatchNavItem[] = [
    { href: "/admin/dispatch", label: "Overview", icon: "overview" },
    { href: "/admin/dispatch/rounds", label: "Rounds", icon: "rounds" },
  ];
  if (caps.has("plan")) items.push({ href: "/admin/dispatch/tutes", label: "Saved tutes", icon: "tutes" });
  if (caps.has("plan") || caps.has("courier"))
    items.push({ href: "/admin/dispatch/students", label: "Students", icon: "students" });
  if (caps.has("finance")) items.push({ href: "/admin/dispatch/money", label: "COD money", icon: "money" });
  if (caps.has("plan") || caps.has("finance") || caps.has("courier"))
    items.push({ href: "/admin/dispatch/reports", label: "Reports", icon: "reports" });
  if (caps.has("plan") || isMainAdmin) items.push({ href: "/admin/dispatch/settings", label: "Settings", icon: "settings" });
  return items;
}
