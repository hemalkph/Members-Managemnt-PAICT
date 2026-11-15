import { expect, test } from "vitest";
import { parseCsv, toCsv } from "@/lib/students/csv";

test("reads quotes, commas, line breaks, CRLF and the BOM; drops empty lines", () => {
  const text = '﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n,,\r\nlast,,end';
  expect(parseCsv(text)).toEqual([
    ["a", "b", "c"],
    ["x, y", 'say "hi"', "two\nlines"],
    ["last", "", "end"],
  ]);
});

test("writes what it reads back", () => {
  const rows = [
    ["student_id", "full_name"],
    ["260001", 'Nimal "Nimi", Perera'],
    ["260002", "නිමල්"],
  ];
  const text = toCsv(rows);
  expect(text.startsWith("﻿")).toBe(true);
  expect(parseCsv(text)).toEqual(rows);
});
