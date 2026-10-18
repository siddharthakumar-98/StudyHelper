"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DIFFICULTY_CHIPS,
  TYPE_CHIPS,
  bankHref,
  statusChips,
  type BankSearch,
  type Status,
} from "./bankView";
import { useHydrated } from "./useHydrated";

type Props = {
  /** The filters in force; `status` is always set (the page resolves the default). */
  search: BankSearch & { status: Status };
  isAdmin: boolean;
  topics: { id: string; name: string }[];
};

const chipBase =
  "tap inline-flex min-h-12 items-center gap-2 rounded-full border-2 px-4 text-lg font-semibold";

function Chip({ href, selected, children }: { href: string; selected: boolean; children: string }) {
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={`${chipBase} ${
        selected
          ? "border-blue-900 bg-blue-900 text-white"
          : "border-zinc-600 bg-white text-zinc-900 hover:bg-zinc-100"
      }`}
    >
      {/* A tick as well as the colour, so the choice is not colour-only. */}
      {selected ? <span aria-hidden="true">✓</span> : null}
      <span>{children}</span>
    </Link>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <div className="mt-4">
      <p id={id} className="mb-2 text-base font-bold text-zinc-800">
        {label}
      </p>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
        {children}
      </div>
    </div>
  );
}

/** Status, type, difficulty and topic filters. Chips are plain links, so the URL is the state. */
export function BankFilters({ search, isAdmin, topics }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const { status, type, difficulty, topicId } = search;
  return (
    <div data-hydrated={hydrated ? "true" : "false"}>
      <Group label="Status">
        {statusChips(isAdmin).map((chip) => (
          <Chip
            key={chip.value}
            href={bankHref({ ...search, status: chip.value })}
            selected={status === chip.value}
          >
            {chip.label}
          </Chip>
        ))}
      </Group>
      <Group label="Type">
        <Chip href={bankHref({ ...search, type: undefined })} selected={!type}>
          All types
        </Chip>
        {TYPE_CHIPS.map((chip) => (
          <Chip key={chip.value} href={bankHref({ ...search, type: chip.value })} selected={type === chip.value}>
            {chip.label}
          </Chip>
        ))}
      </Group>
      <Group label="Difficulty">
        <Chip href={bankHref({ ...search, difficulty: undefined })} selected={!difficulty}>
          Any difficulty
        </Chip>
        {DIFFICULTY_CHIPS.map((chip) => (
          <Chip
            key={chip.value}
            href={bankHref({ ...search, difficulty: chip.value })}
            selected={difficulty === chip.value}
          >
            {chip.label}
          </Chip>
        ))}
      </Group>
      <div className="mt-4 max-w-md">
        <label htmlFor="filter-topic" className="mb-2 block text-base font-bold text-zinc-800">
          Topic
        </label>
        <select
          id="filter-topic"
          value={topicId ?? ""}
          onChange={(event) =>
            router.push(bankHref({ ...search, topicId: event.target.value || undefined }))
          }
          className="tap min-h-12 w-full rounded-lg border-2 border-zinc-600 bg-white px-3 text-lg text-zinc-950"
        >
          <option value="">All topics</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
