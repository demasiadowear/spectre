import type { Metadata } from "next";
import { cookies } from "next/headers";
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
  // Theme persisted in a cookie (default LIGHT) → set server-side, no flash.
  const theme =
    cookies().get("theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang="it" data-theme={theme}>
      <body
        className={`${display.variable} ${mono.variable} ${ui.variable} font-ui antialiased`}
      >
        <DevModeBanner />
        {children}
      </body>
    </html>
  );
}
