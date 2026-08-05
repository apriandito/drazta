import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

/**
 * The built library, as an absolute path.
 *
 * It lives above this app's root, and a relative specifier does not survive
 * Nitro's bundling — the import gets resolved from the output directory rather
 * than from the source file. An absolute alias is stable either way, whether
 * the bundler inlines it or leaves it external.
 */
const DRAZTA = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const FONTS =
  "https://fonts.googleapis.com/css2" +
  "?family=Archivo:wght@500;600;700" +
  "&family=IBM+Plex+Mono:wght@400;500;600" +
  "&family=IBM+Plex+Sans:wght@400;500;600" +
  "&display=swap";

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],

  app: {
    head: {
      htmlAttrs: { lang: "id" },
      title: "Drazta",
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          name: "description",
          content:
            "Console for Drazta — scrape a page and see where every value came from.",
        },
      ],
      link: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossorigin: "",
        },
        { rel: "stylesheet", href: FONTS },
      ],
      script: [
        {
          // Settle the palette before first paint, so a reload in dark mode
          // never flashes the light one.
          innerHTML: `(()=>{try{const s=localStorage.getItem("drazta-theme");const d=s??(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=d}catch{}})()`,
          type: "text/javascript",
          tagPosition: "head",
        },
      ],
    },
  },

  alias: { "#drazta": DRAZTA },

  vite: {
    plugins: [tailwindcss()],
    // The server routes import the built library from the repo root, which
    // sits above this app's root.
    server: { fs: { allow: [".."] } },
  },

  nitro: {
    alias: { "#drazta": DRAZTA },
    // Drazta loads these lazily and they are optionalDependencies — never let
    // the bundler try to resolve them ahead of time.
    externals: { external: ["playwright", "@duckdb/node-api"] },
  },

  typescript: {
    tsConfig: {
      compilerOptions: {
        paths: { "#drazta": [DRAZTA.replace(/\.js$/, ".d.ts")] },
      },
    },
  },
});
