import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { rendererCsp, type RendererCspMode } from './src/shared/csp'

const shared = resolve(__dirname, 'src/shared')

function rendererCspPlugin(mode: RendererCspMode) {
  return {
    name: 'mde-renderer-csp',
    transformIndexHtml(html: string): string {
      return html.replace('__MDE_RENDERER_CSP__', rendererCsp(mode))
    }
  }
}

export default defineConfig(({ command }) => ({
  main: {
    // node-pty is a native module: it must stay external and be resolved at runtime.
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [
      react(),
      tailwindcss(),
      rendererCspPlugin(command === 'serve' ? 'development' : 'production')
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@shared': shared
      }
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    }
  }
}))
