import { Badge } from "@/components/ui/badge";
import type { RoleWithSection } from "@/lib/queries";

/** Roles grouped by section (read-only). */
export function RolesList({ roles, emptyText = "No roles assigned yet." }: { roles: RoleWithSection[]; emptyText?: string }) {
  if (roles.length === 0) return <p className="text-muted-foreground text-sm">{emptyText}</p>;

  const groups = new Map<string, RoleWithSection[]>();
  for (const role of roles) groups.set(role.sectionName, [...(groups.get(role.sectionName) ?? []), role]);

  return (
    <div className="grid gap-3">
      {[...groups.entries()].map(([section, items]) => (
        <div key={section} className="grid gap-1.5">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{section}</p>
          <div className="flex flex-wrap gap-1.5">
            {items.map((role) => (
              <Badge key={role.id} variant="secondary">
                {role.name}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
