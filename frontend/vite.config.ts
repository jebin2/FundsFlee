import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        // The app shell + hashed assets; keep large icons out of precache size limit.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
      // Identical to the Next manifest.json so installed PWAs update in place.
      manifest: {
        name: 'FundsFlee',
        short_name: 'FundsFlee',
        description: 'Your AI spending agent',
        start_url: '/',
        display: 'standalone',
        background_color: '#fcf8ff',
        theme_color: '#1f108e',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        ],
        categories: ['finance', 'productivity'],
        shortcuts: [
          { name: 'Add Expense', short_name: 'Add', url: '/add', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'Paste SMS', short_name: 'Paste', url: '/capture?tab=paste', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
        ],
        share_target: {
          action: '/api/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'image', accept: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }],
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': r('./src'),
      // Map Next.js module specifiers to local shims (see src/shims/*)
      'next/navigation': r('./src/shims/next-navigation.ts'),
      'next/link': r('./src/shims/next-link.tsx'),
      'next/image': r('./src/shims/next-image.tsx'),
      'next-auth/react': r('./src/shims/next-auth-react.tsx'),
    },
  },
  server: {
    // Same-origin in production (FastAPI serves dist/); proxy in dev.
    proxy: {
      '/api': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
    },
  },
})
