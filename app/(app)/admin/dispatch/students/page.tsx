import type { Metadata } from "next";
import Link from "next/link";
import { FileSpreadsheetIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StudentActions } from "@/components/dispatch/student-actions";
import { StudentDialog } from "@/components/dispatch/student-dialog";
import { StudentFilters } from "@/components/dispatch/student-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireDispatch } from "@/lib/dispatch/access";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Students – Tute dispatch" };

const LIMIT = 500;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function DispatchStudentsPage({ searchParams }: PageProps<"/admin/dispatch/students">) {
  const { caps } = await requireDispatch(["plan", "courier"]);
  const canEdit = caps.has("plan");
  const sp = await searchParams;
  // Search text goes into a PostgREST filter, so keep only plain characters.
  const q = one(sp.q).replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 60);
  const batch = uuid.safeParse(one(sp.batch)).success ? one(sp.batch) : "";
  const status = ["inactive", "any"].includes(one(sp.status)) ? one(sp.status) : "active";
  const problem = one(sp.problem);

  const supabase = await createClient();
  let query = supabase
    .from("students")
    .select(
      "id, batch_id, student_no, full_name, address_line1, address_line2, address_line3, city, region, phone1, phone2, phone1_raw, delivery_note, is_active, anonymised_at, updated_at",
      { count: "exact" },
    )
    .order("student_no")
    .limit(LIMIT);
  if (batch) query = query.eq("batch_id", batch);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  if (problem === "address") query = query.or(`address_line1.eq."",city.eq.""`);
  if (problem === "phone") query = query.is("phone1", null);
  if (problem === "phone-check") query = query.not("phone1_raw", "is", null);
  if (q) query = query.or(`student_no.ilike.*${q}*,full_name.ilike.*${q}*,phone1.ilike.*${q}*,city.ilike.*${q}*`);

  const [{ data: students, count }, { data: batchRows }] = await Promise.all([
    query,
    supabase.from("batches").select("id, name, is_active").order("sort_order").order("name"),
  ]);
  const batches = (batchRows ?? []).map((b) => ({ id: b.id, name: b.name }));
  const batchName = new Map(batches.map((b) => [b.id, b.name]));
  const activeBatches = (batchRows ?? []).filter((b) => b.is_active).map((b) => ({ id: b.id, name: b.name }));
  const rows = students ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description={`Delivery details for tute parcels · showing ${rows.length}${count && count > rows.length ? ` of ${count}` : ""}`}
        actions={
          canEdit ? (
            <>
              <Button asChild variant="outline">
                <Link href="/admin/dispatch/students/import">
                  <FileSpreadsheetIcon /> Import
                </Link>
              </Button>
              <StudentDialog batches={activeBatches}>
                <Button disabled={activeBatches.length === 0}>
                  <UserPlusIcon /> Add student
                </Button>
              </StudentDialog>
            </>
          ) : undefined
        }
      />

      <StudentFilters batches={batches} />

      {rows.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={q || batch || problem ? "No students match" : "No students yet"}
          description={canEdit ? "Import a Citypak sheet or CSV, or add students one by one." : "Students added by planners will appear here."}
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">No.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Address</TableHead>
                <TableHead className="hidden sm:table-cell">Phone</TableHead>
                <TableHead className="hidden lg:table-cell">Updated</TableHead>
                {canEdit && (
                  <TableHead className="w-20 pr-4">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const address = [s.address_line1, s.address_line2, s.address_line3].filter(Boolean).join(", ");
                const missing = !s.address_line1 || !s.city;
                return (
                  <TableRow key={s.id} className={s.is_active ? undefined : "opacity-60"}>
                    <TableCell className="pl-4 font-mono text-sm">{s.student_no}</TableCell>
                    <TableCell>
                      <p className="font-medium">{s.full_name}</p>
                      <p className="text-muted-foreground text-xs">
                        {batchName.get(s.batch_id) ?? "—"}
                        {!s.is_active && " · Inactive"}
                        {s.anonymised_at && " · Anonymised"}
                      </p>
                    </TableCell>
                    <TableCell className="hidden max-w-[280px] md:table-cell">
                      {missing ? (
                        <Badge variant="warning">Missing address</Badge>
                      ) : (
                        <>
                          <p className="truncate text-sm">{address}</p>
                          <p className="text-muted-foreground text-xs">{s.city}</p>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {s.phone1 ? (
                        <span className="font-mono text-sm" title={s.phone1_raw ? `Imported as "${s.phone1_raw}"` : undefined}>
                          {s.phone1}
                          {s.phone1_raw && <span className="text-muted-foreground ml-1 text-xs">*</span>}
                        </span>
                      ) : (
                        <Badge variant="warning">No phone</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">{formatDate(s.updated_at)}</TableCell>
                    {canEdit && (
                      <TableCell className="pr-4">
                        {!s.anonymised_at && (
                          <StudentActions
                            active={s.is_active}
                            batches={batches}
                            student={{
                              id: s.id,
                              batch_id: s.batch_id,
                              student_no: s.student_no,
                              full_name: s.full_name,
                              address_line1: s.address_line1,
                              address_line2: s.address_line2,
                              address_line3: s.address_line3,
                              city: s.city,
                              region: s.region,
                              phone1: s.phone1 ?? "",
                              phone2: s.phone2 ?? "",
                              delivery_note: s.delivery_note,
                              expected_updated_at: s.updated_at,
                            }}
                          />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      {rows.some((s) => s.phone1_raw) && (
        <p className="text-muted-foreground text-xs">* The phone number was cleaned on import; hover it to see what the file said.</p>
      )}
    </div>
  );
}
