import { describe, expect, test } from "vitest";
import { feeWhatsAppUrl, renderFeeMessage, sinhalaMonthName, templateUsesTutes } from "@/lib/fees/templates";

describe("fee WhatsApp message rendering", () => {
  test("fills placeholders, preserves emojis and Sinhala text, and cleans empty optional parens", () => {
    const template = "Hi {first_name} 👋✨ Your *{class}* fee for *{month}* ({amount}) is pending ⏳. Prev: {prev_month} ({label})";

    const filled = renderFeeMessage(template, {
      fullName: "Ayodya Karunasena",
      className: "2027 Grand Revision",
      monthLabel: "November 2026",
      prevMonthLabel: "October 2026",
      amount: 3000,
      institute: "Online",
      label: "",
    });

    expect(filled).toBe(
      "Hi Ayodya 👋✨ Your *2027 Grand Revision* fee for *November 2026* (Rs. 3,000) is pending ⏳. Prev: October 2026",
    );
  });

  test("renders Helakuru Sinhala Unicode templates with {month_si}/{prev_month_si} and preserves ZWJ conjuncts", () => {
    expect(sinhalaMonthName("April 2026")).toBe("අප්‍රේල්");
    expect(sinhalaMonthName("2026-11")).toBe("නොවැම්බර්");
    expect(sinhalaMonthName("October 2026")).toBe("ඔක්තෝබර්");

    // Includes Helakuru ZWJ conjuncts: ප්‍ර (rakaransaya), ද්‍ය (yansaya), ශ්‍රී
    const helakuruTemplate =
      "ආයුබෝවන් {first_name} 👋✨\n*{class}* — *{month_si}* මාසයේ පන්ති ගාස්තුව ({amount}) ගෙවීම් ක්‍රමය හරහා සිදු කරන්න 📚.\n*{prev_month_si}* මාසය ගෙවා ඇත ✅. විද්‍යා ප්‍රශ්න පත්‍ර මගනොහරින්න! ශ්‍රී ලංකා 🇱🇰";

    const rendered = renderFeeMessage(helakuruTemplate, {
      fullName: "කවීෂ ප්‍රමෝද්",
      className: "2027 Grand Revision",
      monthLabel: "April 2026",
      prevMonthLabel: "March 2026",
      amount: 3000,
      institute: "Online",
      label: "",
    });

    expect(rendered).toContain("කවීෂ");
    expect(rendered).toContain("*අප්‍රේල්*");
    expect(rendered).toContain("*මාර්තු*");
    expect(rendered).toContain("ක්‍රමය");
    expect(rendered).toContain("විද්‍යා ප්‍රශ්න පත්‍ර");
    expect(rendered).toContain("\u200D"); // ZWJ preserved intact

    const url = feeWhatsAppUrl("94713377422", rendered);
    expect(decodeURIComponent(url.split("text=")[1])).toBe(rendered);
  });

  test("uses api.whatsapp.com/send so emojis are never corrupted", () => {
    const url = feeWhatsAppUrl("94713377422", "Hi Ayodya 👋✨ ස්තූතියි!");
    expect(url.startsWith("https://api.whatsapp.com/send/?phone=94713377422&text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("Hi Ayodya 👋✨ ස්තූතියි!");
  });

  test("renders {tutes}, {tutes_list}, {tute_count}, and {next_month_tutes} with Helakuru Sinhala & collapses cleanly when empty", () => {
    const body = [
      "ආයුබෝවන් {first_name} 👋",
      "*{month_si}* නිබන්ධන ({tute_count}):",
      "{tutes_list}",
      "",
      "ඊළඟ මාසයේ: {next_month_tutes}",
    ].join("\n");

    expect(templateUsesTutes(body)).toBe(true);
    expect(templateUsesTutes("Hi {first_name} 👋")).toBe(false);

    const filled = renderFeeMessage(body, {
      fullName: "Ayodya Karunasena",
      className: "2027 Grand Revision",
      monthLabel: "November 2026",
      prevMonthLabel: "October 2026",
      amount: 3000,
      institute: "Online",
      label: "",
      tutes: ["ඒකකය 07 - දත්ත සමුදාය", "SQL Practice Pack"],
      nextMonthTutes: ["Unit 08 - Networking"],
    });

    expect(filled).toContain("නිබන්ධන (2):");
    expect(filled).toContain("📘 ඒකකය 07 - දත්ත සමුදාය\n📘 SQL Practice Pack");
    expect(filled).toContain("ඊළඟ මාසයේ: Unit 08 - Networking");

    // When a month has no tutes, empty parens and triple newlines collapse cleanly.
    const empty = renderFeeMessage("Hi {first_name}\n\n{tutes_list}\n\nPay ({tute_count}) soon!", {
      fullName: "Ayodya",
      className: "2027 Grand Revision",
      monthLabel: "November 2026",
      prevMonthLabel: "October 2026",
      amount: 3000,
      institute: "Online",
      label: "",
      tutes: [],
    });
    expect(empty).toBe("Hi Ayodya\n\nPay soon!");
  });
});
