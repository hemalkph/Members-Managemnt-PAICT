import "server-only";

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { PAYSLIP_ORGANISATION } from "@/lib/config";
import { formatDate, formatDateTime, formatLKR, formatNumber, maskAccountNumber } from "@/lib/format";
import { monthLabel } from "@/lib/month";
import { workLineLabel, type Payslip } from "@/lib/payslip";

// A4 in points
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.09, 0.1, 0.13);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.86, 0.87, 0.9);
const BRAND = rgb(0.031, 0.408, 0.847); // #0868D8 (logo blue)
const BRAND_SOFT = rgb(0.92, 0.96, 1);
const GREEN = rgb(0.06, 0.55, 0.32);
const AMBER = rgb(0.72, 0.45, 0.02);

/**
 * The standard PDF fonts only cover Western characters. Replace anything
 * else (e.g. Sinhala or emoji) so the PDF still builds.
 */
function safe(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = safe(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

type Fonts = { regular: PDFFont; bold: PDFFont; mono: PDFFont };

function text(
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  opts: { font: PDFFont; size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "right"; width?: number },
) {
  const size = opts.size ?? 10;
  const content = opts.width ? fit(value, opts.font, size, opts.width) : safe(value);
  const w = opts.font.widthOfTextAtSize(content, size);
  page.drawText(content, { x: opts.align === "right" ? x - w : x, y, size, font: opts.font, color: opts.color ?? INK });
}

export async function buildPayslipPdf(slip: Payslip, logo?: Uint8Array | null): Promise<Uint8Array> {
  const p = slip.payout;
  const doc = await PDFDocument.create();
  doc.setTitle(`Payslip ${p.payslip_no} - ${safe(p.member_name)}`);
  doc.setSubject(`Payslip for ${monthLabel(slip.monthKey)}`);
  doc.setAuthor(safe(PAYSLIP_ORGANISATION));
  doc.setCreator("Team Work Tracker");

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // ---------------------------------------------------------------- header band
  page.drawRectangle({ x: 0, y: PAGE_H - 120, width: PAGE_W, height: 120, color: BRAND_SOFT });
  let titleX = MARGIN;
  if (logo) {
    try {
      const image = await doc.embedPng(logo);
      const h = 48;
      const w = (image.width / image.height) * h;
      page.drawImage(image, { x: MARGIN, y: PAGE_H - 84, width: w, height: h });
      titleX = MARGIN + w + 14;
    } catch {
      // Logo is optional.
    }
  }
  text(page, PAYSLIP_ORGANISATION, titleX, PAGE_H - 56, { font: fonts.bold, size: 14 });
  text(page, `Payslip - ${monthLabel(slip.monthKey)}`, titleX, PAGE_H - 74, { font: fonts.regular, size: 11, color: MUTED });
  text(page, "PAYSLIP NO.", PAGE_W - MARGIN, PAGE_H - 52, { font: fonts.regular, size: 8, color: MUTED, align: "right" });
  text(page, p.payslip_no, PAGE_W - MARGIN, PAGE_H - 68, { font: fonts.bold, size: 12, align: "right" });
  y = PAGE_H - 150;

  // ---------------------------------------------------------------- member + bank
  const colW = CONTENT_W / 2 - 10;
  const field = (label: string, value: string | null | undefined, x: number, yy: number, mono = false) => {
    text(page, label, x, yy, { font: fonts.regular, size: 8, color: MUTED });
    text(page, value || "-", x, yy - 13, { font: mono ? fonts.mono : fonts.bold, size: 10, width: colW / 2 - 6 });
  };
  text(page, "PAID TO", MARGIN, y, { font: fonts.bold, size: 8, color: BRAND });
  text(page, "BANK ACCOUNT", MARGIN + colW + 20, y, { font: fonts.bold, size: 8, color: BRAND });
  y -= 18;
  const bx = MARGIN + colW + 20;
  field("Name", p.member_name, MARGIN, y);
  field("NIC", p.member_nic, MARGIN + colW / 2, y, true);
  field("Bank", p.bank_name ?? "Not saved", bx, y);
  field("Branch", p.bank_branch, bx + colW / 2, y);
  y -= 34;
  field("Email", p.member_email, MARGIN, y);
  field("Phone", p.member_phone, MARGIN + colW / 2, y);
  field("Account holder", p.account_holder, bx, y);
  field("Account", p.bank_name ? maskAccountNumber(p.account_last4) : null, bx + colW / 2, y, true);
  y -= 40;

  // ---------------------------------------------------------------- earnings table
  const cols = { desc: MARGIN + 8, qty: MARGIN + CONTENT_W * 0.62, rate: MARGIN + CONTENT_W * 0.8, amount: PAGE_W - MARGIN - 8 };
  const rowH = 30;

  const drawHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 8, width: CONTENT_W, height: 24, color: BRAND_SOFT });
    text(page, "DESCRIPTION", cols.desc, y, { font: fonts.bold, size: 8, color: MUTED });
    text(page, "QTY", cols.qty, y, { font: fonts.bold, size: 8, color: MUTED, align: "right" });
    text(page, "RATE", cols.rate, y, { font: fonts.bold, size: 8, color: MUTED, align: "right" });
    text(page, "AMOUNT", cols.amount, y, { font: fonts.bold, size: 8, color: MUTED, align: "right" });
    y -= 30;
  };
  const newPageIfNeeded = () => {
    if (y < MARGIN + 140) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      drawHeader();
    }
  };
  const row = (title: string, sub: string, qty: string, rate: string, amount: string) => {
    newPageIfNeeded();
    text(page, title, cols.desc, y, { font: fonts.bold, size: 10, width: cols.qty - cols.desc - 60 });
    text(page, sub, cols.desc, y - 12, { font: fonts.regular, size: 8, color: MUTED, width: cols.qty - cols.desc - 60 });
    text(page, qty, cols.qty, y, { font: fonts.regular, size: 10, align: "right" });
    text(page, rate, cols.rate, y, { font: fonts.regular, size: 10, align: "right" });
    text(page, amount, cols.amount, y, { font: fonts.regular, size: 10, align: "right" });
    page.drawLine({ start: { x: MARGIN, y: y - 19 }, end: { x: PAGE_W - MARGIN, y: y - 19 }, thickness: 0.5, color: LINE });
    y -= rowH;
  };

  text(page, "EARNINGS", MARGIN, y, { font: fonts.bold, size: 8, color: BRAND });
  y -= 22;
  drawHeader();
  for (const l of slip.salaryLines) row(l.role, "Fixed monthly salary", "-", "-", formatLKR(l.amount));
  for (const l of slip.workLines) {
    row(
      workLineLabel(l),
      `${l.items} approved submission${l.items === 1 ? "" : "s"}${l.unitPrice === null ? " - no rate set" : ""}`,
      `${formatNumber(l.quantity)}${l.unit ? ` ${l.unit}` : ""}`,
      l.unitPrice === null ? "-" : formatLKR(l.unitPrice),
      formatLKR(l.amount),
    );
  }
  if (slip.salaryLines.length + slip.workLines.length === 0) {
    text(page, "Nothing was earned this month.", cols.desc, y, { font: fonts.regular, size: 10, color: MUTED });
    y -= rowH;
  }

  // ---------------------------------------------------------------- totals
  newPageIfNeeded();
  y -= 4;
  text(page, "Salary", cols.rate, y, { font: fonts.regular, size: 10, color: MUTED, align: "right" });
  text(page, formatLKR(p.salary_amount), cols.amount, y, { font: fonts.regular, size: 10, align: "right" });
  y -= 16;
  text(page, "Work", cols.rate, y, { font: fonts.regular, size: 10, color: MUTED, align: "right" });
  text(page, formatLKR(p.work_amount), cols.amount, y, { font: fonts.regular, size: 10, align: "right" });
  y -= 14;

  const boxH = 54;
  page.drawRectangle({ x: MARGIN, y: y - boxH, width: CONTENT_W, height: boxH, color: BRAND_SOFT, borderColor: LINE, borderWidth: 0.5 });
  text(page, "TOTAL", MARGIN + 14, y - 22, { font: fonts.bold, size: 9, color: MUTED });
  text(page, formatLKR(p.total_amount), MARGIN + 14, y - 42, { font: fonts.bold, size: 18, color: BRAND });

  const paid = p.status === "paid";
  const statusText = paid ? `PAID on ${formatDate(p.paid_on)}` : p.total_amount > 0 ? "NOT PAID YET" : "NOTHING TO PAY";
  text(page, statusText, PAGE_W - MARGIN - 14, y - 26, {
    font: fonts.bold,
    size: 11,
    color: paid ? GREEN : p.total_amount > 0 ? AMBER : MUTED,
    align: "right",
  });
  if (paid && p.payment_reference) {
    text(page, `Reference: ${p.payment_reference}`, PAGE_W - MARGIN - 14, y - 42, {
      font: fonts.regular,
      size: 9,
      color: MUTED,
      align: "right",
    });
  }
  y -= boxH + 26;

  // ---------------------------------------------------------------- footer
  const note = `Amounts were saved when ${monthLabel(slip.monthKey)} was closed${
    slip.closedAt ? ` on ${formatDateTime(slip.closedAt)}` : ""
  }. Prices of approved work are locked at approval.`;
  text(page, note, MARGIN, y, { font: fonts.regular, size: 8, color: MUTED, width: CONTENT_W });
  text(page, `Generated ${formatDateTime(new Date().toISOString())} - Team Work Tracker`, MARGIN, MARGIN - 10, {
    font: fonts.regular,
    size: 7,
    color: MUTED,
  });

  return doc.save();
}
