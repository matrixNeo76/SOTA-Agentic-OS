import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SOTA Agentic OS - Sistema Operativo Agentico",
  description: "Sistema Operativo Agentico SOTA: 9 micro-fasi · memoria persistente · orchestrazione DAG · steering ACTS · verifica LTL · riflessione ERL · context engineering · dominator trees · Lean4 formal · artificial retainer.",
  keywords: ["Agentic OS", "LTL", "ACTS", "ERL", "AutoSOTA", "PatchBoard", "NS-Mem", "Lean4", "Dominator Tree", "Artificial Retainer"],
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
    description: "INTELLIGENT · SECURE · AUTONOMOUS — 9-Micro-Phase Agentic Operating System",
    url: "https://chat.z.ai",
    siteName: "SOTA Agentic OS",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "SOTA Agentic OS" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SOTA Agentic OS",
    description: "INTELLIGENT · SECURE · AUTONOMOUS — 9-Micro-Phase Agentic Operating System",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
