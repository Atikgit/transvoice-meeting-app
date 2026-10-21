/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle (.next/standalone) for the Docker image; ignored by Vercel previews.
  output: 'standalone',
  images: {
    unoptimized: true,
  },
}

export default nextConfig
