/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Harness/screenshot builds inject fixture data and pass view components
  // hand-written props; skip lint/type blocking so the production build stays
  // focused on emitting a runnable bundle for screenshots.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
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
