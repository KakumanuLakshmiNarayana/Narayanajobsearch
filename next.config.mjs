/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ["pdf-parse", "mammoth", "docx"] }
};
export default nextConfig;
