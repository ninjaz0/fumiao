import { defineConfig } from "vite";
export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  base: "/static/",
  build: {
    outDir: "../static",
    emptyOutDir: false,
    lib: {
      entry: "src/main.tsx",
      formats: ["es"],
      fileName: () => "canvas.js",
      cssFileName: "canvas",
    },
    rollupOptions: { output: { assetFileNames: "canvas.[ext]" } },
    sourcemap: false,
  },
});
