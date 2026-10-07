import type { SVGProps } from "react";

/**
 * DESIGN.md icon set: authored SVG, one stroke weight, currentColor.
 * Decorative by default (aria-hidden); pass a `title` only when the icon carries meaning alone.
 */
type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function Icon({ title, children, className = "size-[1.1em]", ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const CheckCircleIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.6 2.6L16.2 9.4" /></Icon>
);
export const HourglassIcon = (p: IconProps) => (
  <Icon {...p}><path d="M7 3h10M7 21h10M8 3c0 4 3 5.5 4 9-1 3.5-4 5-4 9M16 3c0 4-3 5.5-4 9 1 3.5 4 5 4 9" /></Icon>
);
export const OctagonMinusIcon = (p: IconProps) => (
  <Icon {...p}><path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z" /><path d="M8 12h8" /></Icon>
);
export const DottedQuestionIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" strokeDasharray="1.5 3" />
    <path d="M9.8 9.6a2.3 2.3 0 1 1 3.3 2.1c-.7.4-1.1.9-1.1 1.7v.3" />
    <path d="M12 17h.01" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
export const DashIcon = (p: IconProps) => <Icon {...p}><path d="M7 12h10" /></Icon>;
export const ClockIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>
);
export const AlertIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4M12 17h.01" /></Icon>
);
export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Icon>
);
export const InfoIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Icon>
);
export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);
export const ShieldCheckIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></Icon>
);
export const ApproxIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 9c2-2 4-2 7 0s5 2 7 0M5 15c2-2 4-2 7 0s5 2 7 0" /></Icon>
);
export const ArrowDownIcon = (p: IconProps) => <Icon {...p}><path d="M12 5v14M6 13l6 6 6-6" /></Icon>;
export const ArrowUpIcon = (p: IconProps) => <Icon {...p}><path d="M12 19V5M6 11l6-6 6 6" /></Icon>;
export const StarIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  </Icon>
);
export const BellIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></Icon>
);
export const BellOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.7 5A6 6 0 0 1 18 11v2.3M6 11v5l-1.5 2h13" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
    <path d="M3 3l18 18" />
  </Icon>
);
export const ChevronDownIcon = (p: IconProps) => <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>;
export const SearchIcon = (p: IconProps) => <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Icon>;
/** Neutral stand-in when a marketplace sends no product image (or the image fails to load). */
export const ImageMissingIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="m3.5 16 5-5 4 4 2.5-2.5 5.5 5.5" />
    <circle cx="15.5" cy="9" r="1.5" />
  </Icon>
);
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></Icon>
);
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.3 7.4A16.4 16.4 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.2-1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </Icon>
);
export const MailIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="5.5" width="18" height="13" rx="1.5" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></Icon>
);

/** Share: box with an arrow leaving it (Web Share / copy link). */
export const ShareIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 3v12" /><path d="m7.5 7.5 4.5-4.5 4.5 4.5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></Icon>
);

/** Compare: two price labels side by side. */
export const CompareIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="5" width="7.5" height="14" rx="1" /><rect x="13.5" y="5" width="7.5" height="14" rx="1" /><path d="M5.5 9h2.5M16 9h2.5" /></Icon>
);

/** Trend line going down: real drops (Radar). */
export const TrendDownIcon = (p: IconProps) => (
  <Icon {...p}><path d="m3 7 6 6 4-4 8 8" /><path d="M15 17h6v-6" /></Icon>
);

/** Delivery truck: free shipping. */
export const TruckIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7" cy="17.5" r="1.5" /><circle cx="17" cy="17.5" r="1.5" /></Icon>
);

/** Small bar chart: price history / price details. */
export const ChartIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 20h16" /><path d="M7 16v-5M12 16V7M17 16v-8" /></Icon>
);

/** Trend line going up: rising interest (Trending). */
export const TrendUpIcon = (p: IconProps) => (
  <Icon {...p}><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></Icon>
);

export const MonitorIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 4h18v12H3zM8 20h8M12 16v4" /></Icon>
);

export const HeartIcon = (p: IconProps) => (
  <Icon {...p}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></Icon>
);

export const UserIcon = (p: IconProps) => (
  <Icon {...p}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8z" /></Icon>
);

export const TargetIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></Icon>
);

export const FolderIcon = (p: IconProps) => (
  <Icon {...p}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></Icon>
);

export const TicketIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2zM13 5v2M13 17v2M13 11v2" /></Icon>
);

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></Icon>
);

export const ShieldVerifyIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" /></Icon>
);

export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M10 11v6M14 11v6" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </Icon>
);


/** Flag on a pole: "Góp ý dữ liệu" (report wrong data). */
export const FlagIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></Icon>
);
