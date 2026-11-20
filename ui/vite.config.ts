import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Open Graph and Twitter cards only resolve absolute URLs, so index.html writes
// %VITE_PUBLIC_URL% in front of the social image and Vite substitutes it from the
// build environment. When the variable is not set (local dev, a preview host) the
// placeholder is blanked here instead of shipping a literal
// "%VITE_PUBLIC_URL%/og-image.png", which no scraper can read.
function publicUrl(): Plugin {
  return {
    name: 'gitalerts-public-url',
    transformIndexHtml(html: string) {
      return html.replaceAll('%VITE_PUBLIC_URL%', '')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), publicUrl()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
