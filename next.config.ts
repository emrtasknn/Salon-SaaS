import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    serverFunctions: false,
  },
  async headers() {
    return [
      {
        // WP-06 customer status link: the token is in the path, so never leak it via
        // Referer, never index it and never cache the page.
        source: "/:slug/randevu/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
