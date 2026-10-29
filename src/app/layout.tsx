import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import ServiceWorkerRegistration from "./service-worker-registration";
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
  title: "Salon-SaaS — Randevu Yönetimi",
  description:
    "Salon, barbershop ve güzellik merkezleri için online randevu alma, personel yönetimi ve müşteri hikayesi.",
  manifest: "/manifest.json",
  icons: [
    {
      url: "/icons/app-icon.svg",
      sizes: "any",
      type: "image/svg+xml",
    },
  ],
  themeColor: "#171717",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}


