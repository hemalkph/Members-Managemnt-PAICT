import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";

export type ExamChoice = { id: string; label: string; name: string; group: string };

/** Exam choices in a Select, under "2027 A/L – Ranking Full Papers" headings. */
export function ExamOptions({ exams }: { exams: ExamChoice[] }) {
  const groups = [...new Set(exams.map((e) => e.group))];
  return groups.map((g) => (
    <SelectGroup key={g}>
      <SelectLabel>{g}</SelectLabel>
      {exams
        .filter((e) => e.group === g)
        .map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.name}
          </SelectItem>
        ))}
    </SelectGroup>
  ));
}
