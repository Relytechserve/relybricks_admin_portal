/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdf-parse pulls pdfjs-dist; bundling it triggers runtime errors (pdf.mjs / defineProperty).
    serverComponentsExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  },
};

export default nextConfig;
