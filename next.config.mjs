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
      // Ogni route che lancia il chromium serverless deve includerne i
      // binari brotli nella propria lambda (il file tracing non segue i
      // path costruiti a runtime): intent scout, aste scout (cron), e
      // Hunter (sorgente aste selezionabile in ricerca).
      "/api/intent/scout": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/intent/aste": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/hunt": ["./node_modules/@sparticuz/chromium/bin/**"],
    },
  },
};

export default nextConfig;
