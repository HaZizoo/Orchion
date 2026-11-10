/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Groq API key. Vite inlines `VITE_*` values into the client bundle. */
  readonly VITE_GROQ_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
