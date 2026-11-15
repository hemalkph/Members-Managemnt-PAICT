"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Prints the page (the sidebar and top bar hide themselves when printing). */
export function PrintButton() {
  return (
    <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
      <PrinterIcon /> Print
    </Button>
  );
}
