// Vercel serverless entrypoint. Vercel builds this file with esbuild on the
// Node runtime and invokes the default export as the (req, res) handler — and an
// Express app is exactly that. All routes live in server/src/app.ts.
//
// Note: relative imports here (and throughout server/src) carry an explicit
// `.js` extension. Vercel runs this as native ESM on Node, whose resolver does
// NOT probe for extensions — an extensionless specifier throws
// ERR_MODULE_NOT_FOUND at runtime. The `.js` points at the compiled output even
// though the source is `.ts` (standard TypeScript-ESM convention). See ADR-009.
import app from "../server/src/app.js";

export default app;
