// Sinhala font (only the Sinhala letters are downloaded, and only when shown).
import "@fontsource-variable/noto-sans-sinhala";
import { FlaskConicalIcon } from "lucide-react";
import { DispatchLangProvider, LangToggle } from "@/components/dispatch/lang";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { chooseProvider } from "@/lib/citypak/provider";
import { requireDispatch } from "@/lib/dispatch/access";
import { getDispatchLang, getT } from "@/lib/dispatch/i18n/server";

/**
 * Citypak integration: a separate Admin module, not part of Tute dispatch's
 * layout or tabs. Its sections (only "Bulk uploads" today) are listed in the
 * main sidebar under "Citypak integration" (lib/navigation.ts CITYPAK_NAV);
 * each section is its own route under /admin/citypak. This layout holds what
 * every section shares: the access check (Tute dispatch + Courier or Plan),
 * the header with the Demo/Live/Off state, and the English/Sinhala texts.
 */
export default async function CitypakLayout({ children }: LayoutProps<"/admin/citypak">) {
  await requireDispatch(["courier", "plan"]);
  const [t, lang] = await Promise.all([getT(), getDispatchLang()]);
  const choice = chooseProvider();
  const mode = choice.ok ? choice.provider.mode : "off";
  const badge =
    mode === "fixture"
      ? { label: "Demo data", variant: "warning" as const }
      : mode === "live"
        ? { label: "Live", variant: "success" as const }
        : { label: "Off", variant: "outline" as const };

  return (
    <DispatchLangProvider lang={lang}>
      <div className="space-y-6" lang={lang}>
        <PageHeader
          title={t("Citypak integration")}
          description={t("Citypak's records, kept separate from dispatch rounds. Read-only.")}
          actions={
            <>
              <Badge variant={badge.variant}>{t(badge.label)}</Badge>
              <LangToggle />
            </>
          }
        />
        {mode === "fixture" && (
          <Alert>
            <FlaskConicalIcon />
            <AlertTitle>{t("Demo data")}</AlertTitle>
            <AlertDescription>
              {t(
                "These batches and documents are made-up fixture data, not from Citypak. The live connection stays off until Citypak authorises it.",
              )}
            </AlertDescription>
          </Alert>
        )}
        {children}
      </div>
    </DispatchLangProvider>
  );
}
