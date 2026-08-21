import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // frontend/ tem package-lock.json próprio (não é workspace da raiz) — sem
  // isso o Turbopack infere a raiz errada por causa do lockfile do backend
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
