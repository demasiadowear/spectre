import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono, Inter } from "next/font/google";
import "./globals.css";
import DevModeBanner from "@/components/layout/DevModeBanner";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "500", "700"],
  variable: "--font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

const ui = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AYRO SPECTRE — Shadow Sales OS",
  description: "L'ombra digitale che chiude i deal mentre respiri.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body
        className={`${display.variable} ${mono.variable} ${ui.variable} font-ui antialiased`}
      >
        {/* Ambient HUD layers — present on every screen, login included. */}
        <div className="spectre-grid" aria-hidden />
        <div className="spectre-scanbeam" aria-hidden />
        <div className="spectre-scanlines" aria-hidden />

        <DevModeBanner />
        {children}
      </body>
    </html>
  );
}
