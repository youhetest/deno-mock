const router = new Router();
const viewsPath = path.join(Deno.cwd(), "views");

// --- Helper function defined outside the object ---
// Escapes HTML special characters for use in attributes
const escapeAttrHelper = (str: unknown): string => {
    if (typeof str !== 'string') return '';
    // Need the HTML entity ''' for single quotes to be safe in attributes
    // Using double quotes for the JS string literal avoids escaping issues
    return str.replace(/&/g, "&")
              .replace(/</g, "<")
              .replace(/>/g, ">")
              .replace(/"/g, "\"")
              .replace(/'/g, "'"); // Use HTML entity '
};


// Helper function to render EJS templates using dejs
async function render(ctx: Context, templateName: string, data: Record<string, unknown> = {}) {
    try {
        const templatePath = path.join(viewsPath, templateName);
        const template = await Deno.readTextFile(templatePath);

        // Add helpers/global data available to all templates
        const fullData = {
            ...data, // Spread existing data first
            encodeQueryParams: mockService.encodeQueryParams, // Add query param helper
            escapeAttr: escapeAttrHelper // Assign the helper function here
            // Ensure NO trailing comma after the last property ('escapeAttr')
        };

        // Use dejs.renderToString
        const body = await dejs.renderToString(template, fullData);

        ctx.response.headers.set("Content-Type", "text/html; charset=utf-8");
        ctx.response.body = body;
    } catch (error) {
        console.error(`Error rendering template ${templateName}:`, error);
        ctx.response.status = 500;
        ctx.response.body = "Internal Server Error: Failed to render page.";
        ctx.response.headers.set("Content-Type", "text/plain");
    }
}

// --- UI Routes ---

// GET /mock - Display the main page with the mock list and form
router.get("/mock", async (ctx) => {
    const mocks = mockService.getAllMocksSorted();
    await render(ctx, "mock.ejs", { mocks });
});

// POST /add_mock - Handle adding or updating a mock
router.post("/add_mock", async (ctx) => {
    try {
        const formData = await ctx.request.body({ type: "form" }).value;
        console.log("Received form data for add/update:", Object.fromEntries(formData.entries()));

        const pathValue = formData.get("path");
        // Basic server-side validation for path
        if (!pathValue || !pathValue.startsWith('/')) {
             console.error("Invalid path submitted:", pathValue);
             // Redirect back, maybe add query param for error message display later
             ctx.response.redirect("/mock?error=invalid_path");
             return;
        }
        // Basic server-side validation for status code
        const statusCodeRaw = formData.get("status_code") ?? "200";
        const statusCode = parseInt(statusCodeRaw, 10);
        if (isNaN(statusCode) || statusCode < 100 || statusCode > 599) {
             console.error("Invalid status code submitted:", statusCodeRaw);
             ctx.response.redirect("/mock?error=invalid_status");
             return;
        }

        await mockService.addOrUpdateMock({
            name: formData.get("name") ?? "",
            path: pathValue,
            method: formData.get("method") ?? "GET",
            query_string: formData.get("query_params") ?? "",
            status_code: statusCode, // Use parsed and validated status code
            content_type: formData.get("content_type") ?? "application/json",
            response_body: formData.get("response_body") ?? "",
        });
    } catch (error) {
        console.error("Error processing add/update mock:", error);
        // Optionally redirect with a generic error
         ctx.response.redirect("/mock?error=add_failed");
         return; // Prevent further execution like the redirect below
    }
    ctx.response.redirect("/mock");
});

// POST /delete_mock - Handle deleting a mock
router.post("/delete_mock", async (ctx) => {
    try {
        const formData = await ctx.request.body({ type: "form" }).value;
        console.log("Received form data for delete:", Object.fromEntries(formData.entries()));

        const path = formData.get("path");
        const method = formData.get("method");
        const queryString = formData.get("query_params") ?? "";

        if (path && method) {
            await mockService.deleteMock(method, path, queryString);
        } else {
            console.warn("Missing path or method for deletion.");
             ctx.response.redirect("/mock?error=delete_missing_data");
             return;
        }
    } catch (error) {
        console.error("Error processing delete mock:", error);
         ctx.response.redirect("/mock?error=delete_failed");
         return; // Prevent further execution
    }
    ctx.response.redirect("/mock");
});


// --- Mock Handling Route (Catch-all) ---
router.all("/(.*)", async (ctx) => {
    const requestPath = ctx.request.url.pathname;
    const method = ctx.request.method.toUpperCase();
    const queryParams = ctx.request.url.searchParams;

    console.log(`--- Incoming Mock Request ---`);
    console.log(`  Request URL: ${ctx.request.url}`);
    console.log(`  Method: ${method}, Path: ${requestPath}, Query: ${queryParams.toString()}`);

    const result = mockService.findMock(method, requestPath, queryParams);

    if (result) {
        const { mock, matchType } = result;
        const mockName = mock.name || '';
        console.log(`  Serving mock definition (Name: '${mockName}', Type: ${matchType}): ${JSON.stringify(mock)}`);

        ctx.response.status = mock.status_code;
        ctx.response.headers.set("Content-Type", mock.content_type);
        ctx.response.headers.set("X-Mock-Server", "Deno-Oak-Mock-Tool");
        ctx.response.headers.set("X-Mock-Match-Type", matchType);
        if (mockName) {
            try {
                 ctx.response.headers.set("X-Mock-Name", encodeURIComponent(mockName));
             } catch (e) {
                 console.error("Error encoding mock name for header:", e);
                 ctx.response.headers.set("X-Mock-Name", "ErrorEncodingName");
             }
        }
        ctx.response.body = mock.response_body;
    } else {
        // --- 404 Not Found Handling ---
        console.log(`  No mock definition found for method=${method}, path=${requestPath}, query=${queryParams.toString()}`);
        let errorMessage = `Mock definition not found for ${method} ${requestPath}`;
        if (queryParams.toString()) {
            errorMessage += ` with query params ${queryParams.toString()}`;
        }
        errorMessage += ".";

        const possible = mockService.findPossibleMocks(method, requestPath);
        if (possible.length > 0) {
            errorMessage += ` Mocks ARE defined for this path/method with different query parameters:`;
            possible.forEach(p => {
                const qStr = mockService.encodeQueryParams(p.query_params);
                const namePart = p.name ? ` (Name: ${p.name})` : '';
                errorMessage += `\n  - ${p.path}${qStr ? '?' + qStr : ''}${namePart}`;
            });
        }

        ctx.response.status = 404;
        ctx.response.headers.set("Content-Type", "text/plain");
        ctx.response.headers.set("X-Mock-Server", "Deno-Oak-Mock-Tool (Not Found)");
        ctx.response.body = errorMessage;
    }
});


export default router;
