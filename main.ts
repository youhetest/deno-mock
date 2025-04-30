// Instead of: import { Application } from "oak";
import { Application } from "https://deno.land/x/oak@v12.6.1/mod.ts";

// Instead of: import * as dejs from "dejs";
import * as dejs from "https://deno.land/x/dejs@0.10.3/mod.ts";

// Instead of: import * as path from "std/path/mod.ts";
import * as path from "https://deno.land/std@0.208.0/path/mod.ts";

import { Application } from "oak";
import router from "routes.ts";
import { loadMocks } from "mockService.ts";

const app = new Application();
const port = 8055; // Or use Deno.env.get("PORT")

// Logger middleware (optional)
app.use(async (ctx, next) => {
    await next();
    const rt = ctx.response.headers.get("X-Response-Time");
    console.log(`${ctx.request.method} ${ctx.request.url} - ${rt}`);
});

// Timing middleware (optional)
app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    ctx.response.headers.set("X-Response-Time", `${ms}ms`);
});

// Use the router
app.use(router.routes());
app.use(router.allowedMethods()); // Handles OPTIONS requests, 405 Method Not Allowed

// Load mocks before starting the server
await loadMocks();

console.log(`Server listening on http://localhost:${port}`);
console.log(`Mock admin UI available at http://localhost:${port}/mock`);

// Start listening for requests
await app.listen({ port });
