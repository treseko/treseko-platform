import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const configDir = dirname(fileURLToPath(import.meta.url))

function tresekoVersionPlugin() {
  return {
    name: 'treseko-version-json',
    closeBundle() {
      const repoVersionPath = resolve(configDir, '../VERSION')
      const packageJsonPath = resolve(configDir, 'package.json')
      const version = existsSync(repoVersionPath)
        ? readFileSync(repoVersionPath, 'utf-8').trim()
        : JSON.parse(readFileSync(packageJsonPath, 'utf-8')).version
      const distDir = resolve(configDir, 'dist')
      mkdirSync(distDir, { recursive: true })
      writeFileSync(
        resolve(distDir, 'version.json'),
        `${JSON.stringify({
          product: 'treseko-platform',
          version,
        }, null, 2)}\n`,
        'utf-8',
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const frontendPort = Number(env.FRONTEND_PORT || env.VITE_PORT || 5173)
  return {
    plugins: [react(), tresekoVersionPlugin()],
    server: {
      host: env.FRONTEND_HOST || '127.0.0.1',
      port: Number.isFinite(frontendPort) ? frontendPort : 5173,
      allowedHosts: [
        'localhost',
        '127.0.0.1',
        '.ngrok-free.dev',
        '.ngrok-free.app',
      ],
      proxy: {
        '/api': {
          target: env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '')
        },
        '^/informes/': {
          target: env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true
        },
        '^/informes-internos/': {
          target: env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true
        },
        '/ws': {
          target: env.VITE_BACKEND_WS_TARGET || 'ws://127.0.0.1:8000',
          ws: true
        }
      }
    }
  }
})
