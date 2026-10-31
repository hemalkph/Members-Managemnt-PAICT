// The final check before a round is finalised. Pure: the page shows it, and
// the database repeats the blocking checks inside round_finalise.

export type ReviewTute = { id: string; title: string; shortCode: string; qty: number; fromPapers: boolean };
export type ReviewStudent = {
  id: string;
  studentNo: string;
  name: string;
  address: string;
  city: string;
  phone1: string | null;
  active: boolean;
  codAmount: number | null;
  excluded: string[];
};

export type RoundReview = {
  recipients: number;
  parcels: number;
  codTotal: number;
  tuteTotals: { code: string; title: string; parcels: number; copies: number }[];
  blocking: string[];
  warnings: string[];
  firstReference: string | null;
  lastReference: string | null;
};

const REF_CHARS = /^[0-9A-Z]+$/;

export function reviewRound(input: {
  prefix: string;
  defaultCod: number;
  tutes: ReviewTute[];
  chosen: ReviewStudent[];
  /** Active students of the batch who were not chosen. */
  notChosen: number;
  /** References already used anywhere (from earlier rounds). */
  usedReferences: Set<string>;
}): RoundReview {
  const { prefix, tutes, chosen } = input;
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (tutes.length === 0) blocking.push("Add at least one tute.");
  if (chosen.length === 0) blocking.push("Choose at least one student.");

  const missingAddress = chosen.filter((s) => !s.address.trim() || !s.city.trim());
  const missingPhone = chosen.filter((s) => !s.phone1);
  const inactive = chosen.filter((s) => !s.active);
  const empty = chosen.filter((s) => tutes.length > 0 && tutes.every((t) => s.excluded.includes(t.id)));
  const badNo = chosen.filter((s) => !REF_CHARS.test(s.studentNo));
  const conflicts = chosen.filter((s) => input.usedReferences.has(prefix + s.studentNo));
  const list = (xs: ReviewStudent[]) => xs.slice(0, 8).map((s) => s.studentNo).join(", ") + (xs.length > 8 ? ` +${xs.length - 8} more` : "");

  if (missingAddress.length) blocking.push(`Address or city missing: ${list(missingAddress)}`);
  if (missingPhone.length) blocking.push(`Phone missing: ${list(missingPhone)}`);
  if (inactive.length) blocking.push(`No longer active: ${list(inactive)}`);
  if (empty.length) blocking.push(`No tutes in the parcel: ${list(empty)}`);
  if (badNo.length) blocking.push(`Student number can't be used in a reference: ${list(badNo)}`);
  if (conflicts.length) blocking.push(`Reference already used: ${conflicts.slice(0, 8).map((s) => prefix + s.studentNo).join(", ")}`);
  if (input.notChosen > 0) warnings.push(`${input.notChosen} active student${input.notChosen === 1 ? " is" : "s are"} not in this round.`);
  const manual = tutes.filter((t) => !t.fromPapers);
  if (manual.length) warnings.push(`Typed in by hand (not from Papers): ${manual.map((t) => t.shortCode).join(", ")}`);

  const refs = chosen.map((s) => prefix + s.studentNo).sort();
  return {
    recipients: chosen.length,
    parcels: chosen.length - empty.length,
    codTotal: chosen.reduce((sum, s) => sum + (s.codAmount ?? input.defaultCod), 0),
    tuteTotals: tutes.map((t) => {
      const parcels = chosen.filter((s) => !s.excluded.includes(t.id)).length;
      return { code: t.shortCode, title: t.title, parcels, copies: parcels * t.qty };
    }),
    blocking,
    warnings,
    firstReference: refs[0] ?? null,
    lastReference: refs[refs.length - 1] ?? null,
  };
}
