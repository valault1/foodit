// Vercel serverless entrypoint. Vercel builds this file with esbuild on the
// Node runtime and invokes the default export as the (req, res) handler — and an
// Express app is exactly that. All routes live in server/src/app.ts.
//
// Note: imports here (and throughout server/src) are extensionless — the Node/
// esbuild build does not accept explicit `.ts` specifiers. See A4.
import app from "../server/src/app";

export default app;
