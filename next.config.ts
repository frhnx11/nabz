import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  typedRoutes: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return [
      { source: "/", destination: "/pulse", permanent: false },
      // Ops has no landing page of its own: it opens on Dealers.
      { source: "/ops", destination: "/ops/dealers", permanent: false },
      // The Dealers tab was called Respondents until 2026-10-27; keep old links working.
      { source: "/ops/respondents", destination: "/ops/dealers", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Ops pages hold dealer details: keep them out of search engines and caches.
      {
        source: "/ops/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
