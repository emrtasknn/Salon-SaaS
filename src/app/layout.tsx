import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { themeInitScript } from "./_ui/theme";
import { InstallPrompt } from "./pwa/install-prompt";
import { ServiceWorkerRegistrar } from "./pwa/service-worker-registrar";

// Typography: Inter, self-hosted by next/font at build time (no runtime request to Google).
// latin-ext covers Turkish letters (ğ, ş, ı, İ). --font-sans in globals.css falls back to the system stack.
const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-inter" });
// Display face for page titles and large numerals (--font-display in globals.css); also self-hosted.
// Variable weight with the optical-size axis, upright and italic.
const fraunces = Fraunces({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-fraunces", style: ["normal", "italic"], axes: ["opsz"] });

export const metadata: Metadata = {
  applicationName: "RandevuN",
  title: "RandevuN · Online randevu",
  description:
    "Salon, barbershop ve güzellik merkezleri için online randevu yönetimi platformu.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "RandevuN",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/app-icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  // Browser chrome follows the device theme (an explicit in-app choice cannot change this meta).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1413" },
  ],
  // Lets env(safe-area-inset-*) resolve in standalone mode; bars/body pad themselves.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={`${inter.variable} ${fraunces.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Sets <html data-theme> before first paint (no flash of the wrong theme). No CSP is configured. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans text-ink">
        {children}
        <InstallPrompt />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
