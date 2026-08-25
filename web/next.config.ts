import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-web ships .wasm/.mjs assets and touches `self`; it belongs in
  // the client worker bundle only, never traced into a server build.
  serverExternalPackages: ["onnxruntime-web"],

  outputFileTracingExcludes: {
    "*": ["./public/model/**", "./public/ort/**"],
  },

  async headers() {
    return [
      {
        // The model and runtime are content-addressed by filename and change
        // only when a new model version is published, so they are safe to pin
        // in the browser cache for a year. This is what makes the ~27MB
        // download a one-time cost rather than a per-visit one.
        source: "/:dir(model|ort)/:file*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
