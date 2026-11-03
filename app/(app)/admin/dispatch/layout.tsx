// Sinhala font (only the Sinhala letters are downloaded, and only when shown).
import "@fontsource-variable/noto-sans-sinhala";
import { DispatchNav } from "@/components/dispatch/dispatch-nav";
import { DispatchLangProvider } from "@/components/dispatch/lang";
import { requireDispatch } from "@/lib/dispatch/access";
import { getDispatchLang } from "@/lib/dispatch/i18n/server";
import { dispatchNavItems } from "@/lib/dispatch/nav";

export default async function DispatchLayout({ children }: LayoutProps<"/admin/dispatch">) {
  const { profile, caps } = await requireDispatch();
  const lang = await getDispatchLang();
  const items = dispatchNavItems(caps, profile.is_main_admin);

  return (
    <DispatchLangProvider lang={lang}>
      <div className="space-y-6" lang={lang}>
        <DispatchNav items={items} />
        {children}
      </div>
    </DispatchLangProvider>
  );
}
