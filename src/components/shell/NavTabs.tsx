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
                className={`tap flex w-full items-center justify-center px-0.5 py-2 text-center text-[0.62rem] font-semibold leading-tight [overflow-wrap:anywhere] lg:justify-start lg:rounded-lg lg:px-4 lg:text-base ${
                  active
                    ? "bg-blue-900 text-white"
                    : "text-zinc-900 hover:bg-blue-50"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
