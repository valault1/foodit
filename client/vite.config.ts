import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Forward API requests to the Express server during development
      "/api": "http://localhost:3001",
    },
  },
});
