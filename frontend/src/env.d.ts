/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALLOW_LOCAL_FALLBACK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
