import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { optimizeImports } from "carbon-preprocess-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess(), optimizeImports()],
  kit: {
    adapter: adapter(),
    alias: {
      $lib: "./src/lib",
      '@': 'src',
      '$components': 'src/lib/components'
    },
  },
};

export default config;
