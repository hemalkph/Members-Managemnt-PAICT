import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Generic on purpose: chat apps cache preview cards, so no name or amount.
export const alt = "PAICT salary receipt";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(join(process.cwd(), "public/logo.png"));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          background: "linear-gradient(160deg, #ffffff 0%, #eef2ff 100%)",
          color: "#0f172a",
        }}
      >
        <img src={`data:image/png;base64,${logo.toString("base64")}`} width={384} height={236} alt="" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 72, fontWeight: 700 }}>Salary receipt</div>
          <div style={{ fontSize: 36, color: "#475569" }}>PAICT</div>
        </div>
      </div>
    ),
    size,
  );
}
