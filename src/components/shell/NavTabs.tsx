"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/practice", label: "Practice" },
  { href: "/results", label: "Results" },
  { href: "/materials", label: "Materials" },
  { href: "/bank", label: "Question Bank" },
] as const;

type NavHref = (typeof NAV_ITEMS)[number]["href"];

// Simple outline icons (24x24 grid), drawn with the text colour.
const ICON_PATHS: Record<NavHref, string> = {
  "/": "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  "/practice": "M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z",
  "/results": "M4 20V10M10 20V4M16 20v-7M22 20H2",
  "/materials": "M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-6M20 4v14h-6",
  "/bank": "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
};

function NavIcon({ href }: { href: NavHref }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={ICON_PATHS[href]} />
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-300 bg-white pb-[env(safe-area-inset-bottom)] lg:static lg:flex-1 lg:border-t-0 lg:p-3 lg:pb-3"
    >
      <ul className="flex lg:flex-col lg:gap-1">
        {NAV_ITEMS.map(({ href, label }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="min-w-0 flex-1 lg:flex-none">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`tap flex w-full flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-center font-semibold leading-tight lg:flex-row lg:justify-start lg:gap-3 lg:rounded-lg lg:px-4 lg:py-2 ${
                  active
                    ? "bg-blue-900 text-white"
                    : "text-zinc-900 hover:bg-blue-50"
                }`}
              >
                <NavIcon href={href} />
                {/* Bottom-bar labels: at least 14px, capped at 15px so five fit across a phone at any text size. */}
                <span
                  data-nav-label
                  className="text-[length:min(0.8rem,15px)] lg:text-base"
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
