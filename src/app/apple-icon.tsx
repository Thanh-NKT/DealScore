import { ImageResponse } from "next/og";

// iOS home-screen icon: the same DealScore mark as app/icon.svg, rendered to PNG.
// Static asset colours (iris #4F35E3, white) mirror the light tokens; CSS tokens don't apply here.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#4F35E3" }}>
        <svg width="150" height="150" viewBox="0 0 32 32" fill="none">
          <rect x="8.5" y="9" width="6" height="15" rx="3" fill="#FFFFFF" fillOpacity="0.42" />
          <rect x="17.5" y="14.5" width="6" height="9.5" rx="3" fill="#FFFFFF" />
          <path d="M17.6 9.3l2.1 2.1 3.7-4" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size,
  );
}
