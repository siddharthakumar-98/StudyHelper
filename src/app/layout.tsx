import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StudyHelper",
  description: "Practice tests for the IMA diabetology exam",
};

// Applies the saved text size before first paint so the page never flashes.
const TEXT_SCALE_SCRIPT = `try{var s=Number(localStorage.getItem("sh.textScale"));if(s===1.15||s===1.3)document.documentElement.style.setProperty("--text-scale",String(s))}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEXT_SCALE_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
