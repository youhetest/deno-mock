// Import necessary modules using full URLs
import { Router, Context } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import * as dejs from "https://deno.land/x/dejs@0.10.3/mod.ts";
import * as path from "https://deno.land/std@0.208.0/path/mod.ts";
import * as mockService from "./mockService.ts";

const router = new Router();
const scriptDir = path.dirname(path.fromFileUrl(import.meta.url));
const viewsPath = path.join(scriptDir, "views");

// --- Helper function defined outside the object ---
// MAKE SURE THIS IS THE EXACT CODE IN YOUR FILE:
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
        // Add check or better error handling if file doesn't exist
        const template = await Deno.readTextFile(templatePath);

        const fullData = {
            ...data,
            encodeQueryParams: mockService.encodeQueryParams,
            escapeAttr: escapeAttrHelper
        };

        const body = await dejs.renderToString(template, fullData);

        ctx.response.headers.set("Content-Type", "text/html; charset=utf-8");
        ctx.response.body = body;
    } catch (error) {
        console.error(`Error rendering template '${templateName}' at path '${viewsPath}':`, error);
        ctx.response.status = 500;
        ctx.response.body = "Internal Server Error: Failed to render page.";
        ctx.response.headers.set("Content-Type", "text/plain");
    }
}

// --- Rest of the routes code (UI Routes, Mock Handling Route) ---
// ... (Keep the rest of your routes.ts file as it was in the previous correct version) ...

export default router; // Ensure this export is at the end
