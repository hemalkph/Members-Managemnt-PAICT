import { DispatchNav, type DispatchNavItem } from "@/components/dispatch/dispatch-nav";
import { requireDispatch } from "@/lib/dispatch/access";

export default async function DispatchLayout({ children }: LayoutProps<"/admin/dispatch">) {
  const { profile, caps } = await requireDispatch();
  const items: DispatchNavItem[] = [{ href: "/admin/dispatch", label: "Overview" }];
  if (caps.has("plan") || caps.has("courier")) items.push({ href: "/admin/dispatch/students", label: "Students" });
  if (caps.has("plan") || profile.is_main_admin) items.push({ href: "/admin/dispatch/settings", label: "Settings" });

  return (
    <div className="space-y-6">
      <DispatchNav items={items} />
      {children}
    </div>
  );
}
