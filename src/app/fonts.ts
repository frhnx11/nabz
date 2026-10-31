import { Geist, Geist_Mono, Noto_Sans_Devanagari } from "next/font/google";

export const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

/** Geist has no Devanagari; Hindi transcripts and scripts fall back to Noto, loaded only when used. */
export const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500", "600"],
  variable: "--font-devanagari",
  display: "swap",
  preload: false,
});

export const fontVariables = [geistSans, geistMono, devanagari].map((f) => f.variable).join(" ");
