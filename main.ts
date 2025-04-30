import { Application } from "jsr:@oak/oak/application";
import router from "./routes.ts";
import { loadMocks } from "./mockService.ts";

const app = new Application();
const port = 8000; // Or use Deno.env.get("PORT")

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
