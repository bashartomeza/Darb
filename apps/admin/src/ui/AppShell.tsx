import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { IconButton } from "./Button";
import { NAV_GROUPS, type ModuleId, type NavItem } from "../navigation";

export function initialOf(name: string | undefined) {
  const trimmed = (name ?? "").trim();
  return trimmed ? trimmed[0] : "؟";
}

export function notificationPanelState(open: boolean, action: "toggle" | "close") {
  return action === "toggle" ? !open : false;
}

export function NotificationControl({
  label,
  title,
  description,
  closeLabel,
  initiallyOpen = false
}: {
  label: string;
  title: string;
  description: string;
  closeLabel: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen((current) => notificationPanelState(current, "close"));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="topbar__notifications" ref={root}>
      <IconButton
        icon="notifications"
        label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="admin-notifications-panel"
        onClick={() => setOpen((current) => notificationPanelState(current, "toggle"))}
      />
      {open && (
        <section
          className="topbar__notifications-panel"
          id="admin-notifications-panel"
          role="dialog"
          aria-labelledby="admin-notifications-title"
        >
          <div className="topbar__notifications-header">
            <h3 id="admin-notifications-title">{title}</h3>
            <IconButton
              icon="close"
              label={closeLabel}
              onClick={() => setOpen((current) => notificationPanelState(current, "close"))}
            />
          </div>
          <p>{description}</p>
        </section>
      )}
    </div>
  );
}

/**
 * Fixed 256px rail, anchored to the inline-start edge so it sits on the right
 * in Arabic and the left in English without a second stylesheet.
 */
export function SideNav({
  items,
  active,
  onSelect,
  labels,
  footer
}: {
  items: NavItem[];
  active: ModuleId | null;
  onSelect: (id: ModuleId) => void;
  labels: {
    brand: string;
    subtitle: string;
    navigation: string;
    label: (item: NavItem) => string;
    groupLabel: (labelKey: (typeof NAV_GROUPS)[number]["labelKey"]) => string;
  };
  footer: ReactNode;
}) {
  return (
    <aside className="sidenav">
      <div className="sidenav__brand">
        <div>
          <img className="sidenav__logo-img" src="/darb-logo.png" width={550} height={228} alt={labels.brand} />
          <p className="sidenav__brand-subtitle">{labels.subtitle}</p>
        </div>
      </div>

      <nav className="sidenav__nav" aria-label={labels.navigation}>
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group.id);
          if (groupItems.length === 0) return null;
          return (
            <section className="sidenav__group" key={group.id} aria-labelledby={`nav-group-${group.id}`}>
              <h2 className="sidenav__group-label" id={`nav-group-${group.id}`}>
                {labels.groupLabel(group.labelKey)}
              </h2>
              <ul>
                {groupItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={item.id === active ? "sidenav__item is-active" : "sidenav__item"}
                      aria-current={item.id === active ? "page" : undefined}
                      onClick={() => onSelect(item.id)}
                    >
                      <Icon name={item.icon} size={20} />
                      <span>{labels.label(item)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </nav>

      <div className="sidenav__footer">{footer}</div>
    </aside>
  );
}

export function TopBar({
  title,
  search,
  onSearch,
  searchPlaceholder,
  searchLabel,
  notificationsLabel,
  notificationsTitle,
  notificationsDescription,
  closeNotificationsLabel,
  user
}: {
  title: string;
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  searchLabel: string;
  notificationsLabel: string;
  notificationsTitle: string;
  notificationsDescription: string;
  closeNotificationsLabel: string;
  user: { name: string; detail: string };
}) {
  return (
    <header className="topbar">
      <div className="topbar__start">
        <h2 className="topbar__title">{title}</h2>
        <div className="topbar__search">
          <Icon name="search" size={18} />
          <input
            type="search"
            value={search}
            aria-label={searchLabel}
            placeholder={searchPlaceholder}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
      </div>

      <div className="topbar__end">
        <NotificationControl
          label={notificationsLabel}
          title={notificationsTitle}
          description={notificationsDescription}
          closeLabel={closeNotificationsLabel}
        />
        <span className="topbar__divider" aria-hidden="true" />
        <div className="topbar__user">
          <div className="topbar__user-text">
            <p className="topbar__user-name">{user.name}</p>
            <p className="topbar__user-detail">{user.detail}</p>
          </div>
          <span className="avatar avatar--lg" aria-hidden="true">
            {initialOf(user.name)}
          </span>
        </div>
      </div>
    </header>
  );
}

export function AppShell({ sidenav, topbar, children }: { sidenav: ReactNode; topbar: ReactNode; children: ReactNode }) {
  return (
    <div className="shell">
      {sidenav}
      <main className="shell__main">
        {topbar}
        <div className="shell__canvas">{children}</div>
      </main>
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}
