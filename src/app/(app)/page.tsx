import Link from "next/link";

const cardClass =
  "tap flex items-center rounded-xl border-2 border-blue-900 bg-white p-6 text-xl font-bold text-blue-900 hover:bg-blue-50";

export default function Home() {
  return (
    <>
      <h1 className="text-3xl font-bold">Welcome</h1>
      <p className="mt-2 text-lg text-zinc-700">What would you like to open?</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link href="/materials" className={cardClass}>
          Materials
        </Link>
        <Link href="/bank" className={cardClass}>
          Question Bank
        </Link>
      </div>
    </>
  );
}
