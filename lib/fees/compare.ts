// Pure monthly comparison & flagging engine for a single class.
// Compares Previous Month vs Current Month using normalized Gmail OR normalized
// WhatsApp/Mobile phone (catching email changes like Malintha Lakshan's).

import { areNamesCompatible } from "@/lib/fees/parse-sheet";
import { formatPhoneDisplay, pickContactPhone } from "@/lib/fees/phone";
import { toCsv } from "@/lib/students/csv";
import type { ConcessionCard, FeeFollowupStatus } from "@/lib/supabase/database.types";

export type MonthStudentRow = {
  id: string;
  studentKey: string;
  fullName: string;
  emailNorm: string;
  rawEmail: string;
  whatsappNorm: string | null;
  rawWhatsapp: string;
  mobileNorm: string | null;
  rawMobile: string;
  institute: string;
  district: string;
  isNewStudent: boolean;
  amount: number | null;
  exportLabel: string;
  rawClasses: string;
};

export type FollowupRecord = {
  id: string;
  studentKey: string;
  studentName: string;
  emailNorm: string;
  whatsappNorm: string | null;
  status: FeeFollowupStatus;
  label: string;
  messageCount: number;
  lastMessagedAt: string | null;
  lastMessagedBy: string | null;
  lastMessagedByName: string | null;
  lastTemplateId: string | null;
  note: string;
  updatedAt: string;
};

export type ConcessionLabelMatch = {
  fullName: string;
  cardType: ConcessionCard;
  phones: string[];
};

export type StudentKind = "due" | "paid" | "new";

export type ComparedStudent = {
  studentKey: string;
  kind: StudentKind;
  /** How a paid student matched between previous & current month. */
  matchKind: "email" | "phone" | "name" | null;
  /** If paid via phone match with a different Gmail, holds the new current-month email. */
  currentEmail: string | null;
  fullName: string;
  email: string;
  emailNorm: string;
  whatsappNorm: string | null;
  mobileNorm: string | null;
  contactPhone: string | null;
  contactSource: "whatsapp" | "none";
  /** True when a previously messaged due student now has a different WhatsApp number (e.g. upgraded from Mobile-only sheet). */
  contactPhoneChanged: boolean;
  /** The old number previously messaged when `contactPhoneChanged` is true. */
  previousMessagedPhone: string | null;
  institute: string;
  district: string;
  isNewStudent: boolean;
  prevAmount: number | null;
  currAmount: number | null;
  /** Explicit label from the monthly paid export sheet (if any). */
  exportLabel: string;
  /** Inferred fee label (e.g. "Free / Rs. 0" or "Reduced fee") when amount differs from class median. */
  inferredFeeLabel: string | null;
  /** Matched concession card type from the register (only when user also has Concession students access). */
  concessionCard: ConcessionCard | null;
  /** Custom follow-up label set during triage (e.g. "Free card", "Paying Friday"). */
  customLabel: string;
  /** Combined primary display label (customLabel -> exportLabel -> concession -> inferred). */
  primaryLabel: string;
  /** Follow-up state for due students (persisted across re-uploads). */
  followupStatus: FeeFollowupStatus;
  messageCount: number;
  lastMessagedAt: string | null;
  lastMessagedByName: string | null;
  lastTemplateId: string | null;
  note: string;
};

export type FeeComparisonSummary = {
  prevCount: number;
  currCount: number;
  paidBothCount: number;
  phoneMatchedCount: number;
  dueTotal: number;
  dueUnmessaged: number;
  dueMessaged: number;
  dueExcused: number;
  dueDropped: number;
  dueMissingPhone: number;
  newCount: number;
  retentionPct: number;
  medianFee: number | null;
  distinctLabels: string[];
  distinctInstitutes: string[];
  distinctDistricts: string[];
};

export type FeeComparisonResult = {
  rows: ComparedStudent[];
  summary: FeeComparisonSummary;
};

const CARD_DISPLAY: Record<ConcessionCard, string> = {
  free: "Free card",
  half: "Half card",
  paid: "Paid card",
};

function computeMedianPositive(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : Math.round(((nums[mid - 1] + nums[mid]) / 2) * 100) / 100;
}

function inferFeeLabel(amount: number | null, medianFee: number | null): string | null {
  if (amount === null || medianFee === null || medianFee <= 0) return null;
  if (amount === 0) return "Free / Rs. 0";
  if (amount < medianFee * 0.75) return `Reduced (Rs. ${amount.toLocaleString("en-LK")})`;
  return null;
}

function normNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Compare previous-month paid students against current-month paid students for one class.
 */
export function compareClassMonths(params: {
  prevStudents: MonthStudentRow[];
  currStudents: MonthStudentRow[];
  followups: FollowupRecord[];
  concessionLabels?: ConcessionLabelMatch[];
}): FeeComparisonResult {
  const { prevStudents, currStudents, followups, concessionLabels = [] } = params;

  // Build fast 1-to-many indexes for current-month paid students (so shared parent phones never overwrite each other).
  const currByEmail = new Map<string, MonthStudentRow[]>();
  const currByPhone = new Map<string, MonthStudentRow[]>();
  const currByName = new Map<string, MonthStudentRow[]>();
  const pushMap = (map: Map<string, MonthStudentRow[]>, key: string, row: MonthStudentRow) => {
    const list = map.get(key) ?? [];
    if (!list.includes(row)) list.push(row);
    map.set(key, list);
  };
  for (const s of currStudents) {
    if (s.emailNorm) pushMap(currByEmail, s.emailNorm, s);
    if (s.whatsappNorm) pushMap(currByPhone, s.whatsappNorm, s);
    if (s.mobileNorm) pushMap(currByPhone, s.mobileNorm, s);
    const nk = normNameKey(s.fullName);
    if (nk) pushMap(currByName, nk, s);
  }

  // Build fast indexes for follow-ups so records survive even if a student's primary key changes.
  const followupByKey = new Map<string, FollowupRecord>();
  const followupByEmail = new Map<string, FollowupRecord>();
  const followupByWa = new Map<string, FollowupRecord[]>();
  for (const f of followups) {
    followupByKey.set(f.studentKey, f);
    if (f.emailNorm && !followupByEmail.has(f.emailNorm)) followupByEmail.set(f.emailNorm, f);
    if (f.whatsappNorm) {
      const list = followupByWa.get(f.whatsappNorm) ?? [];
      list.push(f);
      followupByWa.set(f.whatsappNorm, list);
    }
  }

  const matchedFollowupIds = new Set<string>();
  const findFollowup = (s: MonthStudentRow): FollowupRecord | null => {
    const claim = (f: FollowupRecord | undefined): FollowupRecord | null => {
      if (!f || matchedFollowupIds.has(f.id)) return null;
      matchedFollowupIds.add(f.id);
      return f;
    };
    const byKey = claim(followupByKey.get(s.studentKey));
    if (byKey) return byKey;
    if (s.emailNorm) {
      const byEmail = claim(followupByEmail.get(s.emailNorm));
      if (byEmail) return byEmail;
    }
    for (const phone of [s.whatsappNorm, s.mobileNorm]) {
      if (!phone) continue;
      const match = claim(
        (followupByWa.get(phone) ?? []).find((f) => !matchedFollowupIds.has(f.id) && areNamesCompatible(f.studentName, s.fullName)),
      );
      if (match) return match;
    }
    return null;
  };

  // Build fast indexes for optional concession cross-labels.
  const concessionByPhone = new Map<string, ConcessionCard>();
  const concessionByName = new Map<string, ConcessionCard>();
  for (const c of concessionLabels) {
    const nk = normNameKey(c.fullName);
    if (nk && !concessionByName.has(nk)) concessionByName.set(nk, c.cardType);
    for (const p of c.phones) {
      if (p && !concessionByPhone.has(p)) concessionByPhone.set(p, c.cardType);
    }
  }
  const findConcession = (s: MonthStudentRow): ConcessionCard | null =>
    (s.whatsappNorm ? concessionByPhone.get(s.whatsappNorm) : undefined) ??
    (s.mobileNorm ? concessionByPhone.get(s.mobileNorm) : undefined) ??
    concessionByName.get(normNameKey(s.fullName)) ??
    null;

  const medianFee = computeMedianPositive([
    ...prevStudents.map((s) => s.amount),
    ...currStudents.map((s) => s.amount),
  ]);

  // Three-pass 1-to-1 matching:
  //   Pass 1: Exact Gmail matches first (so a paid sibling never loses their slot to an unpaid sibling).
  //   Pass 2: Phone fallback (WhatsApp / Mobile) among unclaimed current-month rows with compatible names.
  //   Pass 3: Exact full-name fallback ONLY when either row has neither email nor phone (e.g. cash enrollment without phone).
  const matchedCurrIds = new Set<string>();
  const matchForPrev = new Map<string, { matched: MonthStudentRow; matchKind: "email" | "phone" | "name" }>();

  for (const prev of prevStudents) {
    if (!prev.emailNorm) continue;
    const cand = (currByEmail.get(prev.emailNorm) ?? []).find((c) => !matchedCurrIds.has(c.id));
    if (cand) {
      matchedCurrIds.add(cand.id);
      matchForPrev.set(prev.id, { matched: cand, matchKind: "email" });
    }
  }

  for (const prev of prevStudents) {
    if (matchForPrev.has(prev.id)) continue;
    let found: MonthStudentRow | undefined;
    for (const phone of [prev.whatsappNorm, prev.mobileNorm]) {
      if (!phone) continue;
      const unclaimed = (currByPhone.get(phone) ?? []).filter((c) => !matchedCurrIds.has(c.id));
      found = unclaimed.find((c) => areNamesCompatible(prev.fullName, c.fullName));
      if (found) break;
    }
    if (found) {
      matchedCurrIds.add(found.id);
      matchForPrev.set(prev.id, { matched: found, matchKind: "phone" });
    }
  }

  const hasContact = (s: MonthStudentRow) => Boolean(s.emailNorm || s.whatsappNorm || s.mobileNorm);
  for (const prev of prevStudents) {
    if (matchForPrev.has(prev.id)) continue;
    const nk = normNameKey(prev.fullName);
    if (nk.length < 5) continue;
    const prevMissingContact = !hasContact(prev);
    const cand = (currByName.get(nk) ?? []).find(
      (c) => !matchedCurrIds.has(c.id) && (prevMissingContact || !hasContact(c)),
    );
    if (cand) {
      matchedCurrIds.add(cand.id);
      matchForPrev.set(prev.id, { matched: cand, matchKind: "name" });
    }
  }

  const rows: ComparedStudent[] = [];

  let paidBothCount = 0;
  let phoneMatchedCount = 0;
  let dueTotal = 0;
  let dueUnmessaged = 0;
  let dueMessaged = 0;
  let dueExcused = 0;
  let dueDropped = 0;
  let dueMissingPhone = 0;

  for (const prev of prevStudents) {
    const hit = matchForPrev.get(prev.id);
    const matched = hit?.matched;
    const matchKind = hit?.matchKind ?? null;

    const base = matched ?? prev;
    const contact = pickContactPhone(base.whatsappNorm ?? prev.whatsappNorm);
    const exportLabel = (matched?.exportLabel || prev.exportLabel || "").trim();
    const concessionCard = findConcession(prev) ?? (matched ? findConcession(matched) : null);
    const inferredFeeLabel = inferFeeLabel(matched ? matched.amount : prev.amount, medianFee);

    if (matched) {
      paidBothCount++;
      if (matchKind === "phone") phoneMatchedCount++;

      const primaryLabel = exportLabel || (concessionCard ? CARD_DISPLAY[concessionCard] : "") || inferredFeeLabel || "";
      const emailChanged =
        matchKind === "phone" && Boolean(prev.emailNorm) && Boolean(matched.emailNorm) && matched.emailNorm !== prev.emailNorm;
      rows.push({
        studentKey: prev.studentKey,
        kind: "paid",
        matchKind,
        currentEmail: emailChanged ? matched.rawEmail || matched.emailNorm : null,
        fullName: matched.fullName || prev.fullName,
        email: prev.rawEmail || prev.emailNorm || matched.rawEmail || matched.emailNorm,
        emailNorm: prev.emailNorm || matched.emailNorm,
        whatsappNorm: matched.whatsappNorm ?? prev.whatsappNorm,
        mobileNorm: matched.mobileNorm ?? prev.mobileNorm,
        contactPhone: contact.number,
        contactSource: contact.source,
        contactPhoneChanged: false,
        previousMessagedPhone: null,
        institute: matched.institute || prev.institute,
        district: matched.district || prev.district,
        isNewStudent: prev.isNewStudent,
        prevAmount: prev.amount,
        currAmount: matched.amount,
        exportLabel,
        inferredFeeLabel,
        concessionCard,
        customLabel: "",
        primaryLabel,
        followupStatus: "pending",
        messageCount: 0,
        lastMessagedAt: null,
        lastMessagedByName: null,
        lastTemplateId: null,
        note: "",
      });
    } else {
      const f = findFollowup(prev);
      const followupStatus: FeeFollowupStatus = f?.status ?? "pending";
      const customLabel = f?.label?.trim() ?? "";
      const primaryLabel = customLabel || exportLabel || (concessionCard ? CARD_DISPLAY[concessionCard] : "") || inferredFeeLabel || "";
      const contactPhoneChanged = Boolean(
        followupStatus === "messaged" && contact.number && f?.whatsappNorm && f.whatsappNorm !== contact.number,
      );

      dueTotal++;
      if (followupStatus === "pending") dueUnmessaged++;
      else if (followupStatus === "messaged") dueMessaged++;
      else if (followupStatus === "excused") dueExcused++;
      else if (followupStatus === "dropped") dueDropped++;
      if (!contact.number) dueMissingPhone++;

      rows.push({
        // Reuse matched follow-up's studentKey so re-messaging updates the existing row in place without orphans.
        studentKey: f ? f.studentKey : prev.studentKey,
        kind: "due",
        matchKind: null,
        currentEmail: null,
        fullName: prev.fullName,
        email: prev.rawEmail || prev.emailNorm,
        emailNorm: prev.emailNorm,
        whatsappNorm: prev.whatsappNorm,
        mobileNorm: prev.mobileNorm,
        contactPhone: contact.number,
        contactSource: contact.source,
        contactPhoneChanged,
        previousMessagedPhone: contactPhoneChanged ? (f?.whatsappNorm ?? null) : null,
        institute: prev.institute,
        district: prev.district,
        isNewStudent: prev.isNewStudent,
        prevAmount: prev.amount,
        currAmount: null,
        exportLabel,
        inferredFeeLabel,
        concessionCard,
        customLabel,
        primaryLabel,
        followupStatus,
        messageCount: f?.messageCount ?? 0,
        lastMessagedAt: f?.lastMessagedAt ?? null,
        lastMessagedByName: f?.lastMessagedByName ?? null,
        lastTemplateId: f?.lastTemplateId ?? null,
        note: f?.note ?? "",
      });
    }
  }

  let newCount = 0;
  for (const curr of currStudents) {
    if (matchedCurrIds.has(curr.id)) continue;
    newCount++;
    const contact = pickContactPhone(curr.whatsappNorm);
    const concessionCard = findConcession(curr);
    const inferredFeeLabel = inferFeeLabel(curr.amount, medianFee);
    const primaryLabel = curr.exportLabel || (concessionCard ? CARD_DISPLAY[concessionCard] : "") || inferredFeeLabel || "";

    rows.push({
      studentKey: curr.studentKey,
      kind: "new",
      matchKind: null,
      currentEmail: null,
      fullName: curr.fullName,
      email: curr.rawEmail || curr.emailNorm,
      emailNorm: curr.emailNorm,
      whatsappNorm: curr.whatsappNorm,
      mobileNorm: curr.mobileNorm,
      contactPhone: contact.number,
      contactSource: contact.source,
      contactPhoneChanged: false,
      previousMessagedPhone: null,
      institute: curr.institute,
      district: curr.district,
      isNewStudent: curr.isNewStudent,
      prevAmount: null,
      currAmount: curr.amount,
      exportLabel: curr.exportLabel,
      inferredFeeLabel,
      concessionCard,
      customLabel: "",
      primaryLabel,
      followupStatus: "pending",
      messageCount: 0,
      lastMessagedAt: null,
      lastMessagedByName: null,
      lastTemplateId: null,
      note: "",
    });
  }

  // Sort: Due (pending -> messaged with new WhatsApp # -> messaged -> excused -> dropped) -> Paid -> New; alpha within group.
  const kindRank = (r: ComparedStudent) => {
    if (r.kind === "due") {
      if (r.followupStatus === "pending") return 0;
      if (r.followupStatus === "messaged" && r.contactPhoneChanged) return 1;
      if (r.followupStatus === "messaged") return 2;
      if (r.followupStatus === "excused") return 3;
      return 4;
    }
    if (r.kind === "paid") return r.matchKind === "phone" ? 5 : 6;
    return 7;
  };
  rows.sort((a, b) => kindRank(a) - kindRank(b) || a.fullName.localeCompare(b.fullName));

  const retentionPct = prevStudents.length > 0 ? Math.round((paidBothCount / prevStudents.length) * 1000) / 10 : 0;

  const distinctLabels = [...new Set(rows.map((r) => r.primaryLabel).filter(Boolean))].sort();
  const distinctInstitutes = [...new Set(rows.map((r) => r.institute).filter(Boolean))].sort();
  const distinctDistricts = [...new Set(rows.map((r) => r.district).filter(Boolean))].sort();

  return {
    rows,
    summary: {
      prevCount: prevStudents.length,
      currCount: currStudents.length,
      paidBothCount,
      phoneMatchedCount,
      dueTotal,
      dueUnmessaged,
      dueMessaged,
      dueExcused,
      dueDropped,
      dueMissingPhone,
      newCount,
      retentionPct,
      medianFee,
      distinctLabels,
      distinctInstitutes,
      distinctDistricts,
    },
  };
}

/** Export filtered rows (typically Due students) to a UTF-8 BOM CSV with labels and follow-up status. */
export function comparedRowsToCsv(rows: ComparedStudent[], className: string, dueMonthLabel: string): string {
  const header = [
    "Student Name",
    "Email",
    "WhatsApp",
    "Phone Source",
    "Class",
    "Month",
    "Payment Status",
    "Follow-up Status",
    "Label",
    "Messages Sent",
    "Last Messaged",
    "Prev Amount (Rs.)",
    "Institute",
    "District",
    "Note",
  ];
  const body = rows.map((r) => [
    r.fullName,
    r.email,
    r.contactPhone ? formatPhoneDisplay(r.contactPhone) : "",
    r.contactSource,
    className,
    dueMonthLabel,
    r.kind === "due"
      ? "Due"
      : r.kind === "paid"
        ? r.matchKind === "phone"
          ? "Paid (phone match)"
          : r.matchKind === "name"
            ? "Paid (name match)"
            : "Paid"
        : "New / Current only",
    r.kind === "due" ? r.followupStatus : "",
    r.primaryLabel,
    r.kind === "due" ? String(r.messageCount) : "",
    r.lastMessagedAt ?? "",
    r.prevAmount !== null ? String(r.prevAmount) : "",
    r.institute,
    r.district,
    r.note,
  ]);
  return toCsv([header, ...body]);
}
