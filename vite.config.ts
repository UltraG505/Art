import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/Art/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg", "icons/icon.svg"],
      manifest: {
        name: "Abstract Studio",
        short_name: "Abstract",
        description: "A hand-painting tool for making abstract art on the go.",
        theme_color: "#16151a",
        background_color: "#16151a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/Art/",
        scope: "/Art/",
        icons: [
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
      },
    }),
  ],
});
