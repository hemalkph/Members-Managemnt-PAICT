import { describe, expect, test } from "vitest";
import { accessMap, editablePages, pageAccess, sameStoredAccess, toStoredAccess } from "@/lib/auth/page-access";

const member = { is_admin: false, is_main_admin: false };
const admin = { is_admin: true, is_main_admin: false };

describe("a member page in the page-access model", () => {
  test("members can be given it; admins have it by default; main admins always", () => {
    expect(editablePages(member).map((p) => p.key)).toContain("notices");
    expect(pageAccess({ ...member, page_access: null }, "notices")).toBe("none");
    expect(pageAccess({ ...member, page_access: { notices: "view" } }, "notices")).toBe("view");
    expect(pageAccess({ ...admin, page_access: null }, "notices")).toBe("edit");
    expect(pageAccess({ ...admin, page_access: { notices: "none" } }, "notices")).toBe("none");
    expect(accessMap({ is_admin: true, is_main_admin: true, page_access: { notices: "none" } }).notices).toBe("edit");
  });

  test("saving the Edit member form keeps the choices and nothing else sneaks in", () => {
    const stored = toStoredAccess(member, { notices: "edit", papers: "view" });
    expect(stored).toEqual({ papers: "view", notices: "edit" });
    expect(sameStoredAccess(stored, { notices: "edit", papers: "view" })).toBe(true);
  });

  test("unknown keys, like the removed dispatch page, are dropped", () => {
    const loaded = { notices: "edit", dispatch: "edit" } as unknown;
    expect(toStoredAccess(member, { ...(loaded as object) } as never)).toEqual({ notices: "edit" });
    expect(sameStoredAccess(loaded, { notices: "edit" })).toBe(true);
    expect(editablePages(admin).map((p) => p.key)).not.toContain("dispatch");
  });
});
