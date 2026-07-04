/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Intent Scout: playwright-core e il chromium serverless non si
    // bundlano con webpack — restano require() runtime nella function.
    serverComponentsExternalPackages: ["playwright-core", "@sparticuz/chromium"],
    // Il file tracing non segue i path costruiti a runtime da
    // @sparticuz/chromium: i binari brotli vanno inclusi a mano
    // nella lambda dello scout, altrimenti executablePath() fallisce.
    outputFileTracingIncludes: {
      "/api/intent/scout": ["./node_modules/@sparticuz/chromium/bin/**"],
    },
  },
};

export default nextConfig;
