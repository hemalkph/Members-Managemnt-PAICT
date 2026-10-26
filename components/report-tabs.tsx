import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Switch between the monthly report and the per-exam report. */
export function ReportTabs({ value }: { value: "month" | "exam" }) {
  return (
    <Tabs value={value}>
      <TabsList>
        <TabsTrigger value="month" asChild>
          <Link href="/admin/reports">By month</Link>
        </TabsTrigger>
        <TabsTrigger value="exam" asChild>
          <Link href="/admin/reports/exams">By exam</Link>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
