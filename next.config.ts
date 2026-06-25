import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // WS0.1 — Pacchetti server-side opzionali (nats, redis) non devono rompere il bundling.
  // Vengono caricati via import() dinamico in src/lib/event-mesh/mesh.ts con fallback .catch().
  // Dichiarandoli come external, Next.js non tenta di risolverli a build time.
  serverExternalPackages: ["nats", "redis"],
};

export default nextConfig;
