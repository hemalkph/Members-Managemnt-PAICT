// The main sidebar's collapsible Citypak section, rendered for real (server
// markup) with the current route mocked. No browser needed.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

let pathname = "/admin";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/reactbits/shiny-text", () => ({ default: ({ text }: { text: string }) => text }));
vi.mock("@/components/brand-logo", () => ({ BrandLogo: () => null }));
vi.mock("@/app/actions/auth", () => ({ signOutAction: vi.fn() }));

import { AppSidebar, type SidebarUser } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PAGES, type AccessLevel, type PageKey } from "@/lib/page-access";

const pages = Object.fromEntries(PAGES.map((p) => [p.key, "edit"])) as Record<PageKey, AccessLevel>;
const user = (over: Partial<SidebarUser> = {}): SidebarUser => ({
  name: "Test",
  email: "t@example.test",
  avatarUrl: null,
  isAdmin: true,
  pages,
  citypak: true,
  ...over,
});
const render = (path: string, u = user()) => {
  pathname = path;
  return renderToStaticMarkup(createElement(SidebarProvider, null, createElement(AppSidebar, { user: u, pendingReviews: 0 })));
};
/** The Citypak <li> group (from its collapsible wrapper to the end of its sub-menu). */
const citypakGroup = (html: string) => {
  const start = html.lastIndexOf("<li", html.indexOf("Citypak integration"));
  const end = html.indexOf("</li></ul>", html.indexOf("Citypak integration"));
  return html.slice(start, end === -1 ? undefined : end);
};

/** The opening <a> tag that links to `href` (attributes in any order). */
const linkTo = (html: string, href: string) => html.match(new RegExp(`<a [^>]*href="${href}"[^>]*>`))?.[0] ?? "";

beforeEach(() => {
  pathname = "/admin";
});

describe("Citypak integration in the main sidebar", () => {
  test("a collapsible parent with a chevron, after Tute dispatch, closed outside Citypak", () => {
    const html = render("/admin/dispatch");
    expect(html.indexOf("Citypak integration")).toBeGreaterThan(html.indexOf("Tute dispatch"));
    expect(html.indexOf("Citypak integration")).toBeLessThan(html.indexOf("Activity log"));
    const group = citypakGroup(html);
    expect(group).toMatch(/data-slot="collapsible"/);
    expect(group).toMatch(/data-state="closed"/);
    expect(group).toMatch(/lucide-chevron-right/);
    // Closed: the sub-menu isn't rendered.
    expect(group).not.toMatch(/data-sidebar="menu-sub"/);
  });

  test("opens by itself on Bulk uploads and highlights it", () => {
    const group = citypakGroup(render("/admin/citypak/bulk-uploads"));
    expect(group).toMatch(/data-state="open"/);
    expect(group).toMatch(/data-sidebar="menu-sub"/);
    expect(group).toMatch(/data-sidebar="menu-sub-button"[^>]*data-active="true"[^>]*href="\/admin\/citypak\/bulk-uploads"|href="\/admin\/citypak\/bulk-uploads"[^>]*aria-current="page"/);
    expect(group).toMatch(/aria-current="page"/);
  });

  test("a direct visit to a batch page opens the section with Bulk uploads active", () => {
    const group = citypakGroup(render("/admin/citypak/bulk-uploads/22222222-2222-4222-8222-222222222222"));
    expect(group).toMatch(/data-state="open"/);
    expect(group).toMatch(/aria-current="page"/);
  });

  test("Orders & waybills is listed and highlighted on its list and on an order", () => {
    for (const path of ["/admin/citypak/orders", "/admin/citypak/orders/33333333-3333-4333-8333-333333333333"]) {
      const group = citypakGroup(render(path));
      expect(group).toMatch(/data-state="open"/);
      expect(linkTo(group, "/admin/citypak/orders")).toMatch(/aria-current="page"/);
      expect(linkTo(group, "/admin/citypak/orders")).toMatch(/data-active="true"/);
      expect(linkTo(group, "/admin/citypak/bulk-uploads")).not.toMatch(/aria-current/);
    }
  });

  test("Tute dispatch stays an ordinary item, active on its own pages only", () => {
    const html = render("/admin/dispatch/rounds");
    expect(html).toMatch(/data-active="true"[^>]*href="\/admin\/dispatch"/);
    expect(citypakGroup(html)).not.toMatch(/aria-current="page"/);
  });

  test("not shown without the Courier/Plan permission", () => {
    expect(render("/admin", user({ citypak: false }))).not.toMatch(/Citypak integration/);
  });
});
