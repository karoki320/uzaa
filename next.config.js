/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', destination: '/landing.html' }],
    };
  },
};
