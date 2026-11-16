import { readdirSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  base: "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        steer: resolve(import.meta.dirname, "steer.html"),
        ...Object.fromEntries(
          readdirSync(resolve(import.meta.dirname, "extra"))
            .filter((file) => file.endsWith(".html"))
            .map((file) => [`extra/${file.slice(0, -".html".length)}`, resolve(import.meta.dirname, "extra", file)]),
        ),
      },
    },
  },
})
