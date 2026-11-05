import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { themeInitScript } from "./_ui/theme";
import { InstallPrompt } from "./pwa/install-prompt";
import { ServiceWorkerRegistrar } from "./pwa/service-worker-registrar";

// Typography uses the platform system font stack (see --font-sans in globals.css);
// no web font is downloaded.

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
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  // Lets env(safe-area-inset-*) resolve in standalone mode; bars/body pad themselves.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className="h-full antialiased" suppressHydrationWarning>
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
