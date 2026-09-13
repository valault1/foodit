// Local Bun dev entrypoint only. In production the app runs as a Vercel
// serverless function (see /api/index.ts) and this file is never used.
import app from "./app.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
