import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/webview'),
  build: {
    outDir: resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/webview/main.tsx')
      },
      output: {
        format: 'iife' as const,
        entryFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        inlineDynamicImports: true
      }
    },
    cssCodeSplit: false,
    sourcemap: false,
    chunkSizeWarningLimit: 1500
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})
