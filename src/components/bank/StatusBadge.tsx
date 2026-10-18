import { STATUS_BADGE_CLASS, STATUS_ICON, STATUS_LABEL, type Status } from "./bankView";

/** Status in words and a symbol, never colour alone. */
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-2 px-3 py-1 text-base font-semibold ${STATUS_BADGE_CLASS[status]}`}
    >
      <span aria-hidden="true">{STATUS_ICON[status]}</span>
      <span>{STATUS_LABEL[status]}</span>
    </span>
  );
}
