import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // Workspace packages ship TS sources (main: ./src/index.ts). They must be bundled for runtime.
        exclude: [
          '@alpha/shared-types',
          '@alpha/core-groups',
          '@alpha/core-routing',
          '@alpha/core-history',
          '@alpha/core-adblock',
          '@alpha/core-passwords',
          'zod',
        ],
      }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          guest: resolve('src/preload-guest/index.ts'),
        },
      },
    },
  },
  renderer: {
    appType: 'mpa',
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay/index.html'),
        },
      },
    },
    server: {
      // Windows-native dev: avoid IPv6/hosts edge cases and keep a stable URL for Electron.
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
    publicDir: resolve('resources/public'),
  },
});
