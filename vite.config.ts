import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Chrome extension needs multiple separate builds:
// 1. Side Panel (HTML + React app)
// 2. Background (service worker, single file)
// 3. Content script (single file)
// 4. Injected hooks (single file, runs in page context)

const target = process.env.BUILD_TARGET || 'all';

function sidepanelConfig(): UserConfig {
  return {
    plugins: [react()],
    root: resolve(__dirname, 'src/sidepanel'),
    base: './',
    resolve: { alias: { '@': resolve(__dirname, 'src') } },
    build: {
      outDir: resolve(__dirname, 'dist/sidepanel'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/sidepanel/index.html'),
      },
    },
  };
}

function scriptConfig(name: string, entry: string): UserConfig {
  return {
    resolve: { alias: { '@': resolve(__dirname, 'src') } },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, entry),
        name,
        formats: ['iife'],
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        output: { extend: true },
      },
    },
  };
}

export default defineConfig(() => {
  // Default: build sidepanel (the React app)
  if (target === 'sidepanel') return sidepanelConfig();
  if (target === 'background') return scriptConfig('background', 'src/background/index.ts');
  if (target === 'content') return scriptConfig('content', 'src/content/index.ts');
  if (target === 'injected') return scriptConfig('injected', 'src/injected/hooks.ts');
  // 'all' is handled by the build script
  return sidepanelConfig();
});
