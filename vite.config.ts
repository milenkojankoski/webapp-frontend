import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'vendor-react';
            }
            if (id.includes('firebase')) {
              return 'vendor-firebase';
            }
            if (id.includes('chart.js') || id.includes('lightweight-charts')) {
              return 'vendor-charts';
            }
            if (id.includes('@keetanetwork') || id.includes('protobuf') || id.includes('grpc') || id.includes('google-protobuf')) {
              return 'vendor-keeta';
            }
            if (id.includes('bip39') || id.includes('@noble') || id.includes('buffer') || id.includes('bn.js') || id.includes('elliptic')) {
              return 'vendor-crypto';
            }
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'https://api.alpacadex.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        secure: false,
      },
    },
  },
});