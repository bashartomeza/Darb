/*
 * The Stitch screens pull Material Symbols from the Google Fonts CDN. The
 * console ships the same glyph set as inline SVG instead: no external request,
 * no extra dependency, and it renders under `renderToStaticMarkup` in tests.
 */

export type IconName =
  | "dashboard"
  | "verified_user"
  | "person_pin_circle"
  | "alt_route"
  | "inventory_2"
  | "local_shipping"
  | "edit_road"
  | "analytics"
  | "psychology"
  | "assessment"
  | "history"
  | "settings"
  | "account_circle"
  | "language"
  | "logout"
  | "search"
  | "help"
  | "notifications"
  | "add"
  | "chevron"
  | "arrow"
  | "warning"
  | "near_me"
  | "timer"
  | "directions_car"
  | "verified"
  | "route"
  | "more_vert"
  | "location_on"
  | "refresh"
  | "check"
  | "close"
  | "person"
  | "id_card"
  | "report"
  | "emergency"
  | "block"
  | "check_circle"
  | "play"
  | "star"
  | "flag";

const paths: Record<IconName, string> = {
  dashboard: "M3 3h8v8H3zm10 0h8v5h-8zm0 7h8v11h-8zM3 13h8v8H3z",
  verified_user:
    "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5zm-1 13-3.5-3.5 1.4-1.4L11 12.2l4.1-4.1 1.4 1.4z",
  person_pin_circle:
    "M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7m0 3a2.2 2.2 0 1 1 0 4.4A2.2 2.2 0 0 1 12 5m0 10.4a5 5 0 0 1-3.8-1.8c0-1.2 2.5-1.9 3.8-1.9s3.8.7 3.8 1.9a5 5 0 0 1-3.8 1.8",
  alt_route:
    "M9.8 3.6 12 5.8 9.8 8V6.4H7.6c-.6 3-1.6 5.4-3.1 7.2l-1.4-1.4c1.2-1.5 2-3.4 2.5-5.8H3.2V4.8h4.4V3.6zM16.4 16v-1.6l2.2 2.2-2.2 2.2v-1.6h-2.9c-1.4 0-2.6-.6-3.5-1.6.5-.6.9-1.3 1.3-2 .5.8 1.3 1.4 2.2 1.4zM14.6 4.8h1.8v3.6h3.4v1.8h-3.4v3.4h-1.8V10.2h-3.4V8.4h3.4z",
  inventory_2:
    "M20 4H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1m-1 4H5V6h14zM6 10h12v8H6zm3 2h6v2H9z",
  local_shipping:
    "M18 6h-3V4H3a1 1 0 0 0-1 1v11h2a3 3 0 0 0 6 0h4a3 3 0 0 0 6 0h2v-5zM7 18.5A1.5 1.5 0 1 1 8.5 17 1.5 1.5 0 0 1 7 18.5m10 0a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5m2-6.5h-4V7.5h2.5l1.5 3z",
  edit_road:
    "M4 4h2v16H4zm14 0h2v5h-2zM11 4h2v4h-2zm0 6h2v4h-2zm0 6h2v4h-2zm10.3-3.1-1.2-1.2a.7.7 0 0 0-1 0l-.9.9 2.2 2.2.9-.9a.7.7 0 0 0 0-1M15 17.9V20h2.1l5-5-2.1-2.1z",
  analytics: "M4 20h16v2H4zM6 10h3v8H6zm4.5-5h3v13h-3zM15 13h3v5h-3z",
  psychology:
    "M12 2a8 8 0 0 0-8 8c0 2.4 1 4.2 2.5 5.6V20h3v-2h2v2h3v-2.6a3 3 0 0 0 1.2-2.4h.8a1.5 1.5 0 0 0 1.4-2l-.9-2.4A8 8 0 0 0 12 2m-1 6.5a1.5 1.5 0 1 1-1.5 1.5A1.5 1.5 0 0 1 11 8.5m4 0a1.5 1.5 0 1 1-1.5 1.5A1.5 1.5 0 0 1 15 8.5",
  assessment:
    "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2M9 17H7v-5h2zm4 0h-2V7h2zm4 0h-2v-8h2z",
  history:
    "M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 7 7 6.9 6.9 0 0 1-4.6-1.8l-1.4 1.5A9 9 0 1 0 13 3m-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8z",
  settings:
    "M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.4H11l-.3 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.2A3.2 3.2 0 1 1 16.2 12 3.2 3.2 0 0 1 13 15.2",
  account_circle:
    "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m0 3a3 3 0 1 1-3 3 3 3 0 0 1 3-3m0 14.2a7.2 7.2 0 0 1-6-3.2c0-2 4-3.1 6-3.1s6 1.1 6 3.1a7.2 7.2 0 0 1-6 3.2",
  language:
    "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m6.9 6h-2.9a15.6 15.6 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8M12 4.1A14 14 0 0 1 13.9 8h-3.8A14 14 0 0 1 12 4.1M4.3 14a7.8 7.8 0 0 1 0-4h3.3a16.5 16.5 0 0 0 0 4zm.8 2h2.9a15.6 15.6 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16m2.9-8H5.1a8 8 0 0 1 4.3-3.6A15.6 15.6 0 0 0 8 8m4 11.9A14 14 0 0 1 10.1 16h3.8A14 14 0 0 1 12 19.9m2.3-5.9H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4m.3 5.6A15.6 15.6 0 0 0 16 16h2.9a8 8 0 0 1-4.3 3.6m1.8-5.6a16.5 16.5 0 0 0 0-4h3.3a7.8 7.8 0 0 1 0 4z",
  logout: "M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5zm6.2 4.8-1.4 1.4L16.6 11H9v2h7.6l-1.8 1.8 1.4 1.4L20.4 12z",
  search:
    "M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14",
  help:
    "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m1 17h-2v-2h2zm2.1-7.7-.9.9a3 3 0 0 0-1.2 2.8h-2v-.5a3.6 3.6 0 0 1 1.2-2.6l1.2-1.3a2 2 0 0 0 .6-1.4 2 2 0 0 0-4 0H8a4 4 0 0 1 8 0 3.2 3.2 0 0 1-.9 2.1",
  notifications:
    "M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2m6-6v-5a6 6 0 0 0-4.5-5.8V4.5a1.5 1.5 0 0 0-3 0v.7A6 6 0 0 0 6 11v5l-2 2v1h16v-1z",
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z",
  chevron: "M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z",
  arrow: "M20 11H7.8l4.6-4.6L11 5l-7 7 7 7 1.4-1.4L7.8 13H20z",
  warning: "M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z",
  near_me: "M21 3 3 10.5v.9l7.3 2.3 2.3 7.3h.9z",
  timer:
    "M15 1H9v2h6zm-4 13h2V8h-2zm8.1-6.6 1.4-1.4a10 10 0 0 0-1.4-1.4l-1.4 1.4A8 8 0 1 0 20 12a8 8 0 0 0-.9-4.6",
  directions_car:
    "M18.9 5.5A1.5 1.5 0 0 0 17.5 4.5h-11a1.5 1.5 0 0 0-1.4 1L3 11.5V19a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h12v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-7.5zM6.9 6.5h10.2l1.3 3.8H5.6zM6.5 15A1.5 1.5 0 1 1 8 13.5 1.5 1.5 0 0 1 6.5 15m11 0a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5",
  verified:
    "m23 12-2.4-2.8.3-3.7-3.6-.8-1.9-3.2L12 2.9 8.6 1.5 6.7 4.7l-3.6.8.3 3.7L1 12l2.4 2.8-.3 3.7 3.6.8 1.9 3.2 3.4-1.4 3.4 1.4 1.9-3.2 3.6-.8-.3-3.7zm-12.6 4.2L6.6 12.4 8 11l2.4 2.4L15.8 8l1.4 1.4z",
  route:
    "M19 15.2V7a4 4 0 0 0-4-4 4 4 0 0 0-4 4v10a2 2 0 0 1-4 0V8.8A3 3 0 0 0 9 6a3 3 0 1 0-6 0 3 3 0 0 0 2 2.8V17a4 4 0 0 0 8 0V7a2 2 0 0 1 4 0v8.2A3 3 0 0 0 15 18a3 3 0 1 0 6 0 3 3 0 0 0-2-2.8",
  more_vert:
    "M12 8a2 2 0 1 0-2-2 2 2 0 0 0 2 2m0 2a2 2 0 1 0 2 2 2 2 0 0 0-2-2m0 6a2 2 0 1 0 2 2 2 2 0 0 0-2-2",
  location_on:
    "M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7m0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5",
  refresh:
    "M17.6 6.4A8 8 0 1 0 19.7 14h-2.1a6 6 0 1 1-1.4-6.2L13 11h7V4z",
  check: "m9 16.2-3.5-3.5-1.4 1.4L9 19 20 8l-1.4-1.4z",
  close: "M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z",
  person:
    "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4m0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4",
  id_card:
    "M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2M8.5 7.5a2.2 2.2 0 1 1-2.2 2.2 2.2 2.2 0 0 1 2.2-2.2M13 16H4v-1c0-1.5 3-2.3 4.5-2.3S13 13.5 13 15zm7-5h-5V9h5zm0 4h-5v-2h5z",
  report:
    "M15.7 3H8.3L3 8.3v7.4L8.3 21h7.4L21 15.7V8.3zM13 17h-2v-2h2zm0-4h-2V7h2z",
  emergency:
    "M9 2h6v4.3l3.7-2.2 3 5.2-3.7 2.1 3.7 2.1-3 5.2-3.7-2.2V22H9v-5.5l-3.7 2.2-3-5.2L6 11.4 2.3 9.3l3-5.2L9 6.3z",
  block:
    "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2M4 12a8 8 0 0 1 12.9-6.3L5.7 16.9A7.9 7.9 0 0 1 4 12m8 8a7.9 7.9 0 0 1-4.9-1.7L18.3 7.1A8 8 0 0 1 12 20",
  check_circle:
    "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m-2 15-5-5 1.4-1.4L10 14.2l7.6-7.6L19 8z",
  play: "M8 5v14l11-7z",
  star: "M12 17.3 18.2 21l-1.7-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.5 14l-1.7 7z",
  flag: "M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z"
};

export function Icon({
  name,
  size = 20,
  className,
  filled = false
}: {
  name: IconName;
  size?: number;
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={filled ? { opacity: 1 } : undefined}
    >
      <path d={paths[name]} />
    </svg>
  );
}
