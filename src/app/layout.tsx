import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SOTA Agentic OS — Sistema Operativo Agentico",
  description: "INTELLIGENT · SECURE · AUTONOMOUS — 17 fasi · kernel transazionale + LTL + ERL + Lean4 + Sovereign + Cockpit",
  keywords: ["Agentic OS", "LTL", "ACTS", "ERL", "Lean4", "Sovereign Validator", "Cockpit", "Tool Ecosystem"],
  authors: [{ name: "SOTA Agentic OS" }],
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/favicon.ico",
  },
  openGraph: {
    title: "SOTA Agentic OS",
    description: "INTELLIGENT · SECURE · AUTONOMOUS — Agentic Operating System",
    siteName: "SOTA Agentic OS",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "SOTA Agentic OS" }],
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <a href="#main-content" className="skip-link">Salta al contenuto principale</a>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
