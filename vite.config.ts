import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // When VITE_SUPABASE_PROXY_PATH is set (e.g. "/supabase"), the browser calls
  // the dev server's own origin and Vite forwards to the stack below. This is
  // what lets an HTTPS preview talk to a plain-HTTP local Supabase instance
  // without tripping the mixed-content block. Unset for normal deployments.
  const proxyPath = env.VITE_SUPABASE_PROXY_PATH
  const proxyTarget = env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
  const proxy = proxyPath
    ? {
        [proxyPath]: {
          target: proxyTarget,
          changeOrigin: true,
          ws: true,
          // Strip the prefix so /supabase/rest/v1 → /rest/v1 on the stack.
          rewrite: (path: string) =>
            path.replace(new RegExp(`^${proxyPath}`), '') || '/',
        },
      }
    : undefined

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 12000,
      // The dev server is previewed through the sandbox's
      // *.prod-runtime.all-hands.dev hosts. Vite rejects unknown Host headers,
      // so allow that domain (and its subdomains) or every request returns
      // "Blocked request".
      allowedHosts: ['.prod-runtime.all-hands.dev'],
      proxy,
    },
    preview: {
      host: true,
      port: 12000,
      allowedHosts: ['.prod-runtime.all-hands.dev'],
      proxy,
    },
  }
})
