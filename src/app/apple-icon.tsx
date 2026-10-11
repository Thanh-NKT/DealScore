import { ImageResponse } from "next/og";

// iOS home-screen icon: the same DealScore logo tile as app/icon.svg, rendered to PNG.
// Static asset colours come from DESIGN.md (primary #1F5666, on-primary white); CSS tokens don't apply here.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1F5666" }}>
        <svg width="112" height="112" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3 17 6-6 4 4 8-8" />
          <path d="M15 7h6v6" />
        </svg>
      </div>
    ),
    size,
  );
}
