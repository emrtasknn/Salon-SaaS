import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { InstallPrompt } from "./pwa/install-prompt";
import { ServiceWorkerRegistrar } from "./pwa/service-worker-registrar";

// Typography uses the platform system font stack (see --font-sans in globals.css);
// no web font is downloaded.

export const metadata: Metadata = {
  applicationName: "Salon-SaaS",
  title: "Salon-SaaS · Online randevu",
  description:
    "Salon, barbershop ve güzellik merkezleri için online randevu yönetimi platformu.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Salon-SaaS",
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
  themeColor: "#171717",
  // Lets env(safe-area-inset-*) resolve in standalone mode; bars/body pad themselves.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans text-ink">
        {children}
        <InstallPrompt />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
