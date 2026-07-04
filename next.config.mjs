/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Intent Scout: playwright-core e il chromium serverless non si
    // bundlano con webpack — restano require() runtime nella function.
    serverComponentsExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  },
};

export default nextConfig;
