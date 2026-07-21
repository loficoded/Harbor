import { securityHeaders } from "./security-headers.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Security headers applied to every route (CSP with frame-ancestors 'none',
  // HSTS, nosniff, Referrer-Policy, Permissions-Policy). Defined once in
  // ./security-headers.mjs so they stay unit-testable and drift-free.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // `@harbor/protocol` is a workspace package that ships compiled ESM. Next
  // must run its own loaders over it so the browser bundle can import the
  // Coston2 chain data and protocol addresses directly from source.
  transpilePackages: ["@harbor/protocol"],
  webpack: (config) => {
    // wagmi's connector barrel transitively references optional, native-only
    // dependencies (e.g. @metamask/sdk -> React Native async storage) that are
    // never used in the browser build. Stub them so the build stays clean.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
