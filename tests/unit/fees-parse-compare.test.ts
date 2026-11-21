import { deflateRawSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { compareClassMonths, comparedRowsToCsv, type MonthStudentRow } from "@/lib/fees/compare";
import { normalizeClassEntry, parseStudentCsv, parseStudentXlsx, type ParsedStudentRecord } from "@/lib/fees/parse-sheet";

/** Minimal in-memory ZIP builder for testing real .xlsx multi-sheet workbooks without external libs. */
function makeZip(files: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const rawBytes = enc.encode(content);
    const compBytes = new Uint8Array(deflateRawSync(rawBytes));

    const local = new Uint8Array(30 + nameBytes.length + compBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true); // deflate
    lv.setUint32(18, compBytes.length, true);
    lv.setUint32(22, rawBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(compBytes, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, compBytes.length, true);
    cv.setUint32(24, rawBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const cdSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, Object.keys(files).length, true);
  ev.setUint16(10, Object.keys(files).length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...localParts, ...centralParts, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out.buffer;
}

function toMonthRows(records: ParsedStudentRecord[], prefix: string): MonthStudentRow[] {
  return records.map((r, i) => ({
    id: `${prefix}-${i}`,
    studentKey: r.student_key,
    fullName: r.full_name,
    emailNorm: r.email_norm,
    rawEmail: r.raw_email,
    whatsappNorm: r.whatsapp_norm,
    rawWhatsapp: r.raw_whatsapp,
    mobileNorm: r.mobile_norm,
    rawMobile: r.raw_mobile,
    institute: r.institute,
    district: r.district,
    isNewStudent: r.is_new_student,
    amount: r.amount,
    exportLabel: r.export_label,
    rawClasses: r.raw_classes,
  }));
}

describe("normalizeClassEntry", () => {
  test("extracts canonical class name, batch hint, and month number across months", () => {
    expect(normalizeClassEntry("2027 Grand Revision - October Class (2027 A/L)")).toEqual({
      canonicalName: "2027 Grand Revision",
      batchHint: "2027 A/L",
      monthNumber: 10,
    });
    expect(normalizeClassEntry("2027 Grand Revision - November Class (2027 A/L)")).toEqual({
      canonicalName: "2027 Grand Revision",
      batchHint: "2027 A/L",
      monthNumber: 11,
    });
    expect(normalizeClassEntry("2027 Theory - Nov 2026 (2027 A/L)")).toEqual({
      canonicalName: "2027 Theory",
      batchHint: "2027 A/L",
      monthNumber: 11,
    });
    expect(normalizeClassEntry("2027 Grand Revision - October Class")).toEqual({
      canonicalName: "2027 Grand Revision",
      batchHint: "2027",
      monthNumber: 10,
    });
  });
});

describe("parseStudentCsv & compareClassMonths on real-world export quirks", () => {
  const octoberCsv = [
    "#,Gmail,Student Name,New Student,Mobile,WhatsApp,Address,District,Nearest City,Institute,Classes Count,Classes,Tutes,Tute Count,Tute Delivery,Total Amount (Rs.),Label",
    '1,ekanayakep166@gmail.com,Praveen Ekanayake,No,0782480847,94782480847,"No.4/1 Inamaluwa",Matale,Dambulla,Online,1,2027 Grand Revision - October Class (2027 A/L),,0,Delivery,3000,',
    '2,lakshanmalintha75@gmail.com,Malintha Lakshan,No,774309816,774309816,"32/91/1 Galapitagala",Ampara,Ampara,Online,1,2027 Grand Revision - October Class (2027 A/L),,0,Delivery,3000,',
    '3,sethmibawathma186@gmail.com,Sethmi Bawathma,No,0713811811,0741256235,"289/c, Kaduwela",Colombo,Kaduwela,Online,1,2027 Grand Revision - October Class (2027 A/L),,0,Delivery,3000,',
    '4,sethmibawathma4@gmail.com,Sethmi Bawathma,Yes,94713811811,0741256235,"289/c, Kaduwela",Colombo,Kaduwela,Online,1,2027 Grand Revision - October Class (2027 A/L),,0,Delivery,3000,',
    '5,dissanayakedesadinowanya@gmail.com,Desadi Nowanya,No,393246630328,393246630328,"Anamaduwa",Puttalam,Anamaduwa,Online,1,2027 Grand Revision - October Class (2027 A/L),,0,Delivery,3000,',
    '6,freecard@gmail.com,Nimal Free,No,0711112222,0711112222,"Line 1\nLine 2 හරහා",Kandy,Kandy,Online,1,2027 Grand Revision - October Class (2027 A/L),,0,Delivery,0,Free card',
    // Repeated "New Students" section (must be skipped!)
    "#,Gmail,Student Name,New Student,Mobile,WhatsApp,Address,District,Nearest City,Institute,Classes Count,Classes,Tutes,Tute Count,Tute Delivery,Total Amount (Rs.),Label",
    '1,sethmibawathma4@gmail.com,Sethmi Bawathma,Yes,94713811811,0741256235,"289/c, Kaduwela",Colombo,Kaduwela,Online,1,2027 Grand Revision - October Class (2027 A/L),,0,Delivery,3000,',
    "Metric,Value",
    "Total Students,6",
  ].join("\n");

  const novemberCsv = [
    "#,Gmail,Student Name,New Student,Mobile,WhatsApp,Address,District,Nearest City,Institute,Classes Count,Classes,Tutes,Tute Count,Tute Delivery,Total Amount (Rs.),Label",
    '1,malinthalakshan428@gmail.com,Malintha Lakshan,Yes,94774309816,94774309816,"32/91/1 Galapitagala",Ampara,Ampara,Online,1,2027 Grand Revision - November Class (2027 A/L),,0,Delivery,3000,',
    '2,dissanayakedesadinowanya@gmail.com,Desadi Nowanya,No,393246630328,393246630328,"Anamaduwa",Puttalam,Anamaduwa,Online,1,2027 Grand Revision - November Class (2027 A/L),,0,Delivery,3000,',
    '3,soshibamunusinghe@gmail.com,Soshi Bamunusinghe,Yes,0769147093,0769147093,"Ratnapura",Ratnapura,Godakawela,Online,1,2027 Grand Revision - November Class (2027 A/L),,0,Delivery,3000,',
  ].join("\n");

  test("skips duplicate New Students & Summary sections, deduplicates Sethmi, and catches Malintha via phone", () => {
    const oct = parseStudentCsv(octoberCsv, "oct.csv");
    expect(oct.skippedExtraSections).toBe(true);
    expect(oct.monthNumberHint).toBe(10);
    expect(oct.batchHint).toBe("2027 A/L");
    expect(oct.groups).toHaveLength(1);
    expect(oct.groups[0].detectedName).toBe("2027 Grand Revision");
    expect(oct.groups[0].rawRowCount).toBe(6);
    expect(oct.groups[0].duplicatesMerged).toBe(1);
    expect(oct.groups[0].mergedNames).toEqual(["Sethmi Bawathma"]);
    expect(oct.groups[0].students).toHaveLength(5);

    const nov = parseStudentCsv(novemberCsv, "nov.csv");
    expect(nov.monthNumberHint).toBe(11);
    expect(nov.groups[0].detectedName).toBe("2027 Grand Revision");
    expect(nov.groups[0].students).toHaveLength(3);

    const cmp = compareClassMonths({
      prevStudents: toMonthRows(oct.groups[0].students, "oct"),
      currStudents: toMonthRows(nov.groups[0].students, "nov"),
      followups: [],
    });

    // Malintha (phone match with new Gmail) + Desadi (email match) = 2 paid both months
    expect(cmp.summary.paidBothCount).toBe(2);
    expect(cmp.summary.phoneMatchedCount).toBe(1);
    // Praveen + Sethmi (once!) + Nimal Free = 3 due
    expect(cmp.summary.dueTotal).toBe(3);
    // Soshi = 1 new
    expect(cmp.summary.newCount).toBe(1);

    const malintha = cmp.rows.find((r) => r.fullName === "Malintha Lakshan");
    expect(malintha?.kind).toBe("paid");
    expect(malintha?.matchKind).toBe("phone");
    expect(malintha?.currentEmail).toBe("malinthalakshan428@gmail.com");

    const nimal = cmp.rows.find((r) => r.fullName === "Nimal Free");
    expect(nimal?.kind).toBe("due");
    expect(nimal?.primaryLabel).toBe("Free card");

    const csvOut = comparedRowsToCsv(
      cmp.rows.filter((r) => r.kind === "due"),
      "2027 Grand Revision",
      "November 2026",
    );
    expect(csvOut).toContain("Free card");
    expect(csvOut).toContain("Praveen Ekanayake");
  });

  test("splits multi-class hybrid exports cleanly without overlapping single-class students", () => {
    const hybridCsv = [
      "#,Gmail,Student Name,New Student,Mobile,WhatsApp,Institute,Classes Count,Classes,Total Amount (Rs.)",
      '1,a@gmail.com,Alice Theory,No,0710000001,0710000001,Online,1,2027 Theory - October Class (2027 A/L),3000',
      '2,b@gmail.com,Bob Revision,No,0710000002,0710000002,Online,1,2027 Grand Revision - October Class (2027 A/L),3000',
      '3,c@gmail.com,Chathura Both,No,0710000003,0710000003,Online,2,"2027 Theory - October Class (2027 A/L), 2027 Grand Revision - October Class (2027 A/L)",6000',
    ].join("\n");

    const parsed = parseStudentCsv(hybridCsv, "combined-oct.csv");
    expect(parsed.groups).toHaveLength(2);

    const theory = parsed.groups.find((g) => g.detectedName === "2027 Theory")!;
    const revision = parsed.groups.find((g) => g.detectedName === "2027 Grand Revision")!;

    expect(theory.students.map((s) => s.full_name).sort()).toEqual(["Alice Theory", "Chathura Both"]);
    expect(revision.students.map((s) => s.full_name).sort()).toEqual(["Bob Revision", "Chathura Both"]);
  });

  test("parses 'Rs. 3,000' and 'Rs. 3,000.00' amounts accurately without treating the 'Rs.' dot as a decimal", () => {
    const csv = [
      "Student Name,Gmail,WhatsApp,Classes,Total Amount (Rs.)",
      'Student A,a@gmail.com,0771111111,2027 Theory - Oct (2027 A/L),"Rs. 3,000"',
      'Student B,b@gmail.com,0772222222,2027 Theory - Oct (2027 A/L),"Rs. 3,000.00"',
      'Student C,c@gmail.com,0773333333,2027 Theory - Oct (2027 A/L),"LKR 1,500.50"',
      'Student D,d@gmail.com,0774444444,2027 Theory - Oct (2027 A/L),"Rs. 0"',
    ].join("\n");

    const parsed = parseStudentCsv(csv, "amounts.csv");
    const byName = new Map(parsed.groups[0].students.map((s) => [s.full_name, s.amount]));
    expect(byName.get("Student A")).toBe(3000);
    expect(byName.get("Student B")).toBe(3000);
    expect(byName.get("Student C")).toBe(1500.5);
    expect(byName.get("Student D")).toBe(0);
  });

  test("keeps siblings sharing a parent's phone separate and enforces 1-to-1 matching across months", () => {
    const oct = parseStudentCsv(
      [
        "Student Name,Gmail,WhatsApp,Classes,Total Amount (Rs.)",
        "Kasun Perera,kasun@gmail.com,0771234567,2027 Theory - October Class (2027 A/L),3000",
        "Nimal Perera,nimal@gmail.com,0771234567,2027 Theory - October Class (2027 A/L),3000",
      ].join("\n"),
      "oct-siblings.csv",
    );

    // Siblings with different names & Gmails are NOT merged into 1 student and get distinct student_keys.
    expect(oct.groups[0].students).toHaveLength(2);
    expect(new Set(oct.groups[0].students.map((s) => s.student_key)).size).toBe(2);

    const nov = parseStudentCsv(
      [
        "Student Name,Gmail,WhatsApp,Classes,Total Amount (Rs.)",
        "Kasun Perera,kasun@gmail.com,0771234567,2027 Theory - November Class (2027 A/L),3000",
      ].join("\n"),
      "nov-siblings.csv",
    );

    const cmp = compareClassMonths({
      prevStudents: toMonthRows(oct.groups[0].students, "oct"),
      currStudents: toMonthRows(nov.groups[0].students, "nov"),
      followups: [],
    });

    // Only Kasun paid in November; Nimal must stay flagged as Due (never double-match Kasun's payment).
    expect(cmp.summary.paidBothCount).toBe(1);
    expect(cmp.summary.dueTotal).toBe(1);
    expect(cmp.rows.find((r) => r.fullName === "Kasun Perera")?.kind).toBe("paid");
    expect(cmp.rows.find((r) => r.fullName === "Nimal Perera")?.kind).toBe("due");
  });

  test("supports Enrollments CSV exports: excludes rejected/failed/revoked before dedup, skips Item/Value footer, labels FREE_ENROLLMENT, and mixes cleanly with standard exports", () => {
    const enrollmentsOctCsv = [
      "Student name,Class,Status,Method,Enrolled on,Access state,Student index,Nearest city,District,Address,Mobile",
      'Kaveesha Dilkini,2027 Grand Revision - October Class,rejected,bank_transfer,"20/11/2026, 20:38:17",none,270096,Homagama,Colombo,"No.205,Walpita",0740411443',
      'Praveen Ekanayake,2027 Grand Revision - October Class,activated,bank_transfer,"16/11/2026, 13:48:16",active,270171,Dambulla,Matale,"No.4/1 Inamaluwa",0782480847',
      'Udara Dilmith,2027 Grand Revision - October Class,activated,card_payment,"02/11/2026, 17:02:02",active,270163,Wathupitiwala,Gampaha,"207/B Maimbula",0741711750',
      'Udara Dilmith,2027 Grand Revision - October Class,failed,card_payment,"02/11/2026, 17:00:52",none,270163,Wathupitiwala,Gampaha,"207/B Maimbula",0741711750',
      'Avishka Mihiranga,2027 Grand Revision - October Class,failed,card_payment,"01/11/2026, 11:21:41",none,270113,Siripura,Polonnaruwa,"No:59 Meevathpura",0763594421',
      'Sethmi Bawathma,2027 Grand Revision - October Class,activated,cash,"01/11/2026, 08:05:07",active,270086,kaduwela,Colombo,"289/c, Kaduwela",0713811811',
      'Sethmi Bawathma,2027 Grand Revision - October Class,activated,bank_transfer,"23/10/2026, 20:58:09",revoked,270285,kaduwela,Colombo,"289/c, Kaduwela",94713811811',
      'Lasindu Nimsara,2027 Grand Revision - October Class,activated,cash,"07/10/2026, 07:57:18",expired,250004,Deraniyagala,Kegalle,"S/26 Hathkela",0723969901',
      'Lasindu Nimsara,2027 Grand Revision - October Class,rejected,bank_transfer,"07/10/2026, 06:54:51",none,250004,Deraniyagala,Kegalle,"S/26 Hathkela",0723969901',
      'Lasindu Nimsara,2027 Grand Revision - October Class,failed,card_payment,"06/10/2026, 18:18:54",none,250004,Deraniyagala,Kegalle,"S/26 Hathkela",0723969901',
      'Sithum Senehas,2027 Grand Revision - October Class,activated,FREE_ENROLLMENT,"16/10/2026, 20:46:44",expired,270272,Hanwella,Gampaha,"57/D welgama",0772385442',
      'koshitha tharanda,2027 Grand Revision - October Class,activated,cash,"02/10/2026, 08:15:39",revoked,270123,embilipitiya,Ratnapura,"no 92 d",0771721163',
      'Venu Shehara,2027 Grand Revision - October Class,activated,cash,"04/10/2026, 00:21:43",expired,,,,,',
      // Genuine duplicate valid activated payment in the same sheet (should still merge and count as 1 duplicate)
      'Double Paid,2027 Grand Revision - October Class,activated,bank_transfer,"10/10/2026, 10:00:00",expired,270999,Kandy,Kandy,"Addr",0779998888',
      'Double Paid,2027 Grand Revision - October Class,activated,cash,"11/10/2026, 10:00:00",active,270999,Kandy,Kandy,"Addr",94779998888',
      // Trailing report metadata footer (must be skipped cleanly, never imported as students!)
      "Item,Value",
      "Report,Students Export Template",
      "Dataset,Enrollments",
      'Generated,"21/11/2026, 15:27:01"',
      "Generated by,Owner",
      "Rows,15",
      "Sorted by,Enrolled on (high → low)",
      ",",
      "Filters,",
      ",Class is one of 2027 Grand Revision - October Class",
    ].join("\n");

    const oct = parseStudentCsv(enrollmentsOctCsv, "enrollments-oct.csv");
    expect(oct.skippedExtraSections).toBe(true);
    expect(oct.monthNumberHint).toBe(10);
    expect(oct.batchHint).toBe("2027");
    expect(oct.groups).toHaveLength(1);

    const g = oct.groups[0];
    expect(g.detectedName).toBe("2027 Grand Revision");
    // 2 rejected (Kaveesha, Lasindu) + 3 failed (Udara, Avishka, Lasindu) + 2 revoked (Sethmi, koshitha) = 7 excluded
    expect(g.excludedRows).toMatchObject({ total: 7, rejected: 2, failed: 3, revoked: 2, pending: 0 });
    expect(oct.excludedRows.total).toBe(7);

    // Failed/rejected retries for Udara, Sethmi, Lasindu are NOT counted as duplicate payments; only Double Paid is merged!
    expect(g.duplicatesMerged).toBe(1);
    expect(g.mergedNames).toEqual(["Double Paid"]);

    const names = g.students.map((s) => s.full_name).sort();
    expect(names).toEqual([
      "Double Paid",
      "Lasindu Nimsara",
      "Praveen Ekanayake",
      "Sethmi Bawathma",
      "Sithum Senehas",
      "Udara Dilmith",
      "Venu Shehara",
    ]);
    // Rejected/failed/revoked-only students are completely absent
    expect(names).not.toContain("Kaveesha Dilkini");
    expect(names).not.toContain("Avishka Mihiranga");
    expect(names).not.toContain("koshitha tharanda");
    // Footer metadata rows are completely absent
    expect(names).not.toContain("Report");
    expect(names).not.toContain("Dataset");

    // FREE_ENROLLMENT gets a filterable "Free enrollment" label; regular bank/card/cash methods stay clean
    expect(g.students.find((s) => s.full_name === "Sithum Senehas")?.export_label).toBe("Free enrollment");
    expect(g.students.find((s) => s.full_name === "Praveen Ekanayake")?.export_label).toBe("");
    // This sheet had Mobile only (no WhatsApp column), so all 7 are flagged as missing WhatsApp for messaging
    // while still retaining Mobile for cross-month matching!
    expect(oct.hasWhatsAppColumn).toBe(false);
    expect(g.missingPhoneCount).toBe(7);

    // Mix October (Enrollments CSV) against November (Standard Paid Export with Gmail + WhatsApp + a phoneless Venu Shehara)
    const standardNovCsv = [
      "#,Gmail,Student Name,New Student,Mobile,WhatsApp,District,Institute,Classes Count,Classes,Total Amount (Rs.)",
      "1,ekanayakep166@gmail.com,Praveen Ekanayake,No,0782480847,94782480847,Matale,Online,1,2027 Grand Revision - November Class (2027 A/L),3000",
      "2,lasindu@gmail.com,Lasindu Nimsara,No,0723969901,0723969901,Kegalle,Online,1,2027 Grand Revision - November Class (2027 A/L),3000",
      "3,,Venu Shehara,No,,,Colombo,Online,1,2027 Grand Revision - November Class (2027 A/L),3000",
    ].join("\n");
    const nov = parseStudentCsv(standardNovCsv, "standard-nov.csv");

    const cmp = compareClassMonths({
      prevStudents: toMonthRows(g.students, "oct"),
      currStudents: toMonthRows(nov.groups[0].students, "nov"),
      followups: [],
    });

    // Praveen + Lasindu matched by phone, Venu Shehara matched by exact name (no phone/email on either side)
    expect(cmp.summary.paidBothCount).toBe(3);
    expect(cmp.summary.dueTotal).toBe(4); // Udara, Sethmi, Sithum, Double Paid
    const praveen = cmp.rows.find((r) => r.fullName === "Praveen Ekanayake");
    expect(praveen?.kind).toBe("paid");
    expect(praveen?.matchKind).toBe("phone");
    expect(praveen?.email).toBe("ekanayakep166@gmail.com");
    expect(praveen?.currentEmail).toBeNull(); // Previous month had no Gmail column, so don't flag as "changed Gmail"

    // Due students from a Mobile-only export never fall back to Mobile for WhatsApp messaging
    const udara = cmp.rows.find((r) => r.fullName === "Udara Dilmith");
    expect(udara?.contactPhone).toBeNull();
    expect(udara?.contactSource).toBe("none");
    expect(udara?.mobileNorm).toBe("94741711750");

    const venu = cmp.rows.find((r) => r.fullName === "Venu Shehara");
    expect(venu?.kind).toBe("paid");
    expect(venu?.matchKind).toBe("name");
  });

  test("re-uploading a month with WhatsApp numbers keeps Mobile-matched follow-ups and flags only students whose WhatsApp differs from the old Mobile", () => {
    const octWithWa = parseStudentCsv(
      [
        "Student name,Class,Status,Method,Enrolled on,Access state,Student index,District,Mobile,WhatsApp",
        'kuvindu wethum,2027 Grand Revision - October Class,activated,bank_transfer,"04/10/2026",expired,270150,Gampaha,0725777748,0722415164',
        'Malintha Lakshan,2027 Grand Revision - October Class,activated,cash,"09/11/2026",active,270019,Ampara,774309816,774309816',
        'Thisara Senethmi,2027 Grand Revision - October Class,activated,bank_transfer,"25/10/2026",active,270131,Kalutara,0705270905,0776663401',
      ].join("\n"),
      "oct-with-wa.csv",
    );
    expect(octWithWa.hasWhatsAppColumn).toBe(true);
    expect(octWithWa.groups[0].missingPhoneCount).toBe(0);

    // November CSV has Mobile only (no WhatsApp column) — Thisara must still match as Paid via Mobile!
    const novMobileOnly = parseStudentCsv(
      [
        "Student name,Class,Status,Method,Enrolled on,Access state,Student index,District,Mobile",
        'Thisara Senethmi,2027 Grand Revision - November Class,activated,bank_transfer,"21/11/2026",active,270131,Kalutara,0705270905',
      ].join("\n"),
      "nov-mobile-only.csv",
    );

    // Follow-ups previously saved when October only had Mobile numbers:
    const existingFollowups = [
      {
        id: "f-kuvindu",
        studentKey: "mob:94725777748",
        studentName: "kuvindu wethum",
        emailNorm: "",
        whatsappNorm: "94725777748",
        status: "messaged" as const,
        label: "Wrong number",
        messageCount: 1,
        lastMessagedAt: "2026-11-21T12:22:00Z",
        lastMessagedBy: "u1",
        lastMessagedByName: "Minupama",
        lastTemplateId: null,
        note: "isn't on wp",
        updatedAt: "2026-11-21T12:22:00Z",
      },
      {
        id: "f-malintha",
        studentKey: "mob:94774309816",
        studentName: "Malintha Lakshan",
        emailNorm: "",
        whatsappNorm: "94774309816",
        status: "messaged" as const,
        label: "",
        messageCount: 1,
        lastMessagedAt: "2026-11-21T12:24:00Z",
        lastMessagedBy: "u1",
        lastMessagedByName: "Minupama",
        lastTemplateId: null,
        note: "",
        updatedAt: "2026-11-21T12:24:00Z",
      },
    ];

    const cmp = compareClassMonths({
      prevStudents: toMonthRows(octWithWa.groups[0].students, "oct"),
      currStudents: toMonthRows(novMobileOnly.groups[0].students, "nov"),
      followups: existingFollowups,
    });

    // Thisara matched as Paid via Mobile even though October now uses her different WhatsApp number!
    expect(cmp.summary.paidBothCount).toBe(1);
    expect(cmp.summary.dueTotal).toBe(2);

    // kuvindu got a NEW WhatsApp number (0722415164 != old 0725777748) -> flagged contactPhoneChanged,
    // keeps existing studentKey ("mob:94725777748") so re-messaging updates the same DB row cleanly!
    const kuvindu = cmp.rows.find((r) => r.fullName === "kuvindu wethum")!;
    expect(kuvindu.studentKey).toBe("mob:94725777748");
    expect(kuvindu.contactPhone).toBe("94722415164");
    expect(kuvindu.contactSource).toBe("whatsapp");
    expect(kuvindu.contactPhoneChanged).toBe(true);
    expect(kuvindu.previousMessagedPhone).toBe("94725777748");
    expect(kuvindu.note).toBe("isn't on wp");

    // Malintha's WhatsApp == old Mobile -> stays Messaged without flagging contactPhoneChanged!
    const malintha = cmp.rows.find((r) => r.fullName === "Malintha Lakshan")!;
    expect(malintha.studentKey).toBe("mob:94774309816");
    expect(malintha.contactPhone).toBe("94774309816");
    expect(malintha.contactPhoneChanged).toBe(false);
    expect(malintha.previousMessagedPhone).toBeNull();
  });
});

describe("parseStudentXlsx", () => {
  test("reads multi-sheet .xlsx workbook, skips Summary and New Students sheets, and parses shared strings", async () => {
    const sharedStrings = [
      "Student Name",
      "Gmail",
      "WhatsApp",
      "Classes",
      "Total Amount (Rs.)",
      "Pasindu සත්සර",
      "pasindu@gmail.com",
      "2027 Grand Revision - November Class (2027 A/L)",
      "Metric",
      "Value",
    ];
    const sstXml = `<?xml version="1.0" encoding="UTF-8"?><sst>${sharedStrings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`;
    const sheet1Xml = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>
      <row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2"><v>9.4774309816E10</v></c><c r="D2" t="s"><v>7</v></c><c r="E2"><v>3000</v></c></row>
    </sheetData></worksheet>`;
    const sheet2Xml = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>8</v></c><c r="B1" t="s"><v>9</v></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>Total Students</t></is></c><c r="B2"><v>1</v></c></row>
    </sheetData></worksheet>`;
    const workbookXml = `<?xml version="1.0" encoding="UTF-8"?><workbook><sheets>
      <sheet name="All Students" sheetId="1" r:id="rId1"/>
      <sheet name="Summary" sheetId="2" r:id="rId2"/>
    </sheets></workbook>`;
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?><Relationships>
      <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
    </Relationships>`;

    const buf = makeZip({
      "xl/workbook.xml": workbookXml,
      "xl/_rels/workbook.xml.rels": relsXml,
      "xl/sharedStrings.xml": sstXml,
      "xl/worksheets/sheet1.xml": sheet1Xml,
      "xl/worksheets/sheet2.xml": sheet2Xml,
    });

    const parsed = await parseStudentXlsx(buf, "nov.xlsx");
    expect(parsed.sheetName).toBe("All Students");
    expect(parsed.skippedExtraSections).toBe(true);
    expect(parsed.monthNumberHint).toBe(11);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].students[0]).toMatchObject({
      full_name: "Pasindu සත්සර",
      email_norm: "pasindu@gmail.com",
      whatsapp_norm: "94774309816",
      amount: 3000,
    });
  });
});
