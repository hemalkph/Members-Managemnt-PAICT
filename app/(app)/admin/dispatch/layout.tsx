// Sinhala font (only the Sinhala letters are downloaded, and only when shown).
import "@fontsource-variable/noto-sans-sinhala";
import { DispatchNav, type DispatchNavItem } from "@/components/dispatch/dispatch-nav";
import { DispatchLangProvider } from "@/components/dispatch/lang";
import { requireDispatch } from "@/lib/dispatch/access";
import { getDispatchLang } from "@/lib/dispatch/i18n/server";

export default async function DispatchLayout({ children }: LayoutProps<"/admin/dispatch">) {
  const { profile, caps } = await requireDispatch();
  const lang = await getDispatchLang();
  const items: DispatchNavItem[] = [
    { href: "/admin/dispatch", label: "Overview", icon: "overview" },
    { href: "/admin/dispatch/rounds", label: "Rounds", icon: "rounds" },
  ];
  if (caps.has("plan") || caps.has("courier"))
    items.push({ href: "/admin/dispatch/students", label: "Students", icon: "students" });
  if (caps.has("finance")) items.push({ href: "/admin/dispatch/money", label: "COD money", icon: "money" });
  if (caps.has("plan") || caps.has("finance") || caps.has("courier"))
    items.push({ href: "/admin/dispatch/reports", label: "Reports", icon: "reports" });
  if (caps.has("plan") || profile.is_main_admin)
    items.push({ href: "/admin/dispatch/settings", label: "Settings", icon: "settings" });

  return (
    <DispatchLangProvider lang={lang}>
      <div className="space-y-6" lang={lang}>
        <DispatchNav items={items} />
        {children}
      </div>
    </DispatchLangProvider>
  );
}
