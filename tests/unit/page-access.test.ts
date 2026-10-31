import { describe, expect, test } from "vitest";
import { accessMap, editablePages, pageAccess, sameStoredAccess, toStoredAccess } from "@/lib/page-access";

const member = { is_admin: false, is_main_admin: false };
const admin = { is_admin: true, is_main_admin: false };

describe("the dispatch page in the existing page-access model", () => {
  test("members can be given it; admins have it by default; main admins always", () => {
    expect(editablePages(member).map((p) => p.key)).toContain("dispatch");
    expect(pageAccess({ ...member, page_access: null }, "dispatch")).toBe("none");
    expect(pageAccess({ ...member, page_access: { dispatch: "view" } }, "dispatch")).toBe("view");
    expect(pageAccess({ ...admin, page_access: null }, "dispatch")).toBe("edit");
    expect(pageAccess({ ...admin, page_access: { dispatch: "none" } }, "dispatch")).toBe("none");
    expect(accessMap({ is_admin: true, is_main_admin: true, page_access: { dispatch: "none" } }).dispatch).toBe("edit");
  });

  test("saving the Edit member form keeps the dispatch choice and nothing else sneaks in", () => {
    const stored = toStoredAccess(member, { dispatch: "edit", papers: "view" });
    expect(stored).toEqual({ papers: "view", dispatch: "edit" });
    expect(sameStoredAccess(stored, { dispatch: "edit", papers: "view" })).toBe(true);
  });

  test("an unknown key (e.g. a capability list) would be dropped – which is why capabilities live in their own table", () => {
    const loaded = { dispatch: "edit", dispatch_caps: ["pack"] } as unknown;
    expect(toStoredAccess(member, { ...(loaded as object) } as never)).toEqual({ dispatch: "edit" });
    expect(sameStoredAccess(loaded, { dispatch: "edit" })).toBe(true);
  });
});
