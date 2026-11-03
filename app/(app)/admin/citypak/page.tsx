import { redirect } from "next/navigation";

/** The Citypak module's entry: its first section (the layout has already checked access). */
export default function CitypakIndexPage() {
  redirect("/admin/citypak/bulk-uploads");
}
