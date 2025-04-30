// Import necessary modules using full URLs
import * as path from "https://deno.land/std@0.208.0/path/mod.ts";        // Keep only ONE path import
import { exists } from "https://deno.land/std@0.208.0/fs/exists.ts";    // Import 'exists' function
// Removed unused Application and dejs imports that were here
// Removed duplicate path import that was here

const MOCKS_FILE = path.join(Deno.cwd(), "mocks.json");
// Note: Using Deno.cwd() might be problematic in some deployment environments
// if the current working directory isn't what you expect or if the filesystem
// isn't writable/persistent. For Deno Deploy, CWD is usually the project root.

export interface MockDefinition {
    name: string;
    path: string; // Normalized path (starts with /)
    method: string; // Uppercase
    query_params: Record<string, string>; // Dictionary of query params
    status_code: number;
    content_type: string;
    response_body: string;
}

// Use a Map for efficient lookups. Key: "METHOD:/path:sorted_query_string"
let mockDefinitions: Map<string, MockDefinition> = new Map();

/**
 * URL-encodes a dictionary into a query string, sorting keys.
 */
export function encodeQueryParams(params: Record<string, string> | URLSearchParams): string {
    if (!params) return "";

    let items: [string, string][];
    if (params instanceof URLSearchParams) {
        items = Array.from(params.entries());
    } else {
        items = Object.entries(params);
    }

    if (items.length === 0) return "";

    items.sort(([keyA, valA], [keyB, valB]) => {
        if (keyA < keyB) return -1;
        if (keyA > keyB) return 1;
        if (valA < valB) return -1;
        if (valA > valB) return 1;
        return 0;
    });

    const searchParams = new URLSearchParams();
    items.forEach(([key, value]) => searchParams.append(key, value));
    return searchParams.toString();
}


/**
 * Generates a unique key for the mock definition map.
 * Key format: "METHOD:/normalized/path:sorted_query_string"
 */
function generateMockKey(method: string, rawPath: string, query: Record<string, string> | URLSearchParams | string | null | undefined): string {
    const normalizedPath = normalizePath(rawPath);
    let sortedQueryString = "";

    if (query) {
        if (typeof query === 'string') {
            sortedQueryString = encodeQueryParams(new URLSearchParams(query));
        } else if (query instanceof URLSearchParams) {
             sortedQueryString = encodeQueryParams(query);
        } else {
            sortedQueryString = encodeQueryParams(query);
        }
    }

    // Ensure consistent key format even with empty query string
    return `${method.toUpperCase()}:${normalizedPath}:${sortedQueryString}`;
}

/**
 * Normalizes a path: ensures it starts with '/' and removes trailing '/'.
 */
function normalizePath(rawPath: string): string {
    let path = rawPath.trim();
    if (!path) return '/'; // Handle empty input path

    if (!path.startsWith('/')) {
        path = '/' + path;
    }
    // Remove trailing slash only if it's not the root path itself
    if (path.length > 1 && path.endsWith('/')) {
        path = path.slice(0, -1);
    }
    return path;
}

/**
 * Loads mock definitions from JSON file into the Map.
 */
export async function loadMocks(): Promise<void> {
    mockDefinitions = new Map();
    console.log(`Attempting to load mocks from: ${MOCKS_FILE}`); // Add log for debugging path

    // Check if the file exists before trying to read
    try {
        // Use exists helper function
        const fileExists = await exists(MOCKS_FILE, { isFile: true });
        if (!fileExists) {
            console.log(`Mock file '${MOCKS_FILE}' not found or is not a file. Starting with empty definitions.`);
            // Attempt to create the file if it doesn't exist, to avoid errors on first save
            try {
                await Deno.writeTextFile(MOCKS_FILE, "[]"); // Create empty JSON array
                console.log(`Created empty mock file at '${MOCKS_FILE}'.`);
            } catch (createError) {
                 console.error(`Could not create mock file '${MOCKS_FILE}':`, createError);
                 // Continue without mocks if creation fails
            }
            return;
        }
    } catch (checkError) {
         console.error(`Error checking existence of mock file '${MOCKS_FILE}':`, checkError);
         // Continue with empty mocks if check fails
         return;
    }


    try {
        const content = await Deno.readTextFile(MOCKS_FILE);
        if (!content.trim()) {
            console.log(`Mock file '${MOCKS_FILE}' is empty.`);
            return;
        }

        const mocksList: Partial<MockDefinition>[] = JSON.parse(content);
        let count = 0;
        for (const mockData of mocksList) {
            const method = mockData.method?.toUpperCase();
            const rawPath = mockData.path;
            const queryParams = mockData.query_params ?? {};

            if (method && rawPath !== undefined && rawPath !== null) { // Check rawPath explicitly
                const normalizedPath = normalizePath(rawPath);
                const key = generateMockKey(method, normalizedPath, queryParams);

                const fullMock: MockDefinition = {
                    name: mockData.name ?? '',
                    path: normalizedPath,
                    method: method,
                    query_params: queryParams,
                    status_code: mockData.status_code ?? 200,
                    content_type: mockData.content_type ?? 'application/json',
                    response_body: mockData.response_body ?? '',
                };

                mockDefinitions.set(key, fullMock);
                count++;
            } else {
                console.warn(`Skipping invalid mock entry (missing method or path): ${JSON.stringify(mockData)}`);
            }
        }
        console.log(`Loaded ${count} valid mocks from '${MOCKS_FILE}'.`);

    } catch (error) {
        console.error(`Error loading/parsing mocks from '${MOCKS_FILE}':`, error);
        mockDefinitions = new Map(); // Reset on error
    }
}

/**
 * Saves current mock definitions (Map values) to the JSON file.
 */
async function saveMocks(): Promise<void> {
    const mocksList = Array.from(mockDefinitions.values());
    try {
        await Deno.writeTextFile(MOCKS_FILE, JSON.stringify(mocksList, null, 2));
        console.log(`Saved ${mocksList.length} mocks to '${MOCKS_FILE}'.`);
    } catch (error) {
        console.error(`Error saving mocks to '${MOCKS_FILE}':`, error);
        // Consider how to handle save errors - maybe retry? Log severity?
    }
}

/**
 * Adds or updates a mock definition.
 */
export async function addOrUpdateMock(data: Omit<MockDefinition, 'query_params'> & { query_string?: string }): Promise<void> {
    // Ensure required fields have sane defaults or are validated before this point (like in router)
    const method = data.method.toUpperCase();
    const normalizedPath = normalizePath(data.path); // Path validation should happen before calling this
    const queryParams = Object.fromEntries(new URLSearchParams(data.query_string ?? '').entries());
    const statusCode = data.status_code >= 100 && data.status_code <= 599 ? data.status_code : 200; // Ensure valid status

    const key = generateMockKey(method, normalizedPath, queryParams);

    const mockData: MockDefinition = {
        name: (data.name ?? "").trim(), // Ensure name is string
        path: normalizedPath,
        method: method,
        query_params: queryParams,
        status_code: statusCode,
        content_type: (data.content_type ?? "application/json").trim(), // Ensure content_type is string
        response_body: data.response_body ?? "" // Ensure response_body is string
    };

    mockDefinitions.set(key, mockData);
    console.log(`Upserted mock with key: ${key}`);
    await saveMocks(); // Save changes
}

/**
 * Deletes a mock definition based on method, path, and query string.
 */
export async function deleteMock(method: string, path: string, queryString: string): Promise<boolean> {
    const key = generateMockKey(method, path, queryString);
    if (mockDefinitions.has(key)) {
        mockDefinitions.delete(key);
        console.log(`Deleted mock with key: ${key}`);
        await saveMocks(); // Save changes
        return true;
    } else {
        console.warn(`Mock not found for deletion with key: ${key}`);
        // Optional: Log existing keys for debugging
        // console.log("Available keys:", Array.from(mockDefinitions.keys()));
        return false;
    }
}

/**
 * Finds a mock definition matching the request details.
 */
export function findMock(method: string, requestPath: string, queryParams: URLSearchParams): { mock: MockDefinition; matchType: 'Exact' | 'Fallback (Path Only)' } | null {
    const normalizedPath = normalizePath(requestPath);

    // 1. Try exact match
    const exactKey = generateMockKey(method, normalizedPath, queryParams);
    console.log(`  Attempting exact match lookup with key: ${exactKey}`);
    let mock = mockDefinitions.get(exactKey);
    if (mock) {
        console.log(`  Found exact match!`);
        return { mock, matchType: 'Exact' };
    }

    // 2. Try fallback match only if exact match failed AND query params were present in the request
    if (queryParams.toString() !== '') {
        const fallbackKey = generateMockKey(method, normalizedPath, {}); // Empty query params for fallback key
        console.log(`  Exact match failed. Attempting fallback match with key: ${fallbackKey}`);
        mock = mockDefinitions.get(fallbackKey);
        if (mock) {
            console.log(`  Found fallback match (mock defined for path without specific query params).`);
            return { mock, matchType: 'Fallback (Path Only)' };
        }
    }

    console.log(`  No match found for path ${normalizedPath} and query ${queryParams.toString()}.`);
    return null;
}

/**
 * Gets all mock definitions, sorted for display.
 */
export function getAllMocksSorted(): MockDefinition[] {
    const mocks = Array.from(mockDefinitions.values());
    mocks.sort((a, b) => {
        const nameA = a.name.toLowerCase();
        const nameB = b.name.toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;

        if (a.path < b.path) return -1;
        if (a.path > b.path) return 1;

        if (a.method < b.method) return -1;
        if (a.method > b.method) return 1;

        const queryA = encodeQueryParams(a.query_params);
        const queryB = encodeQueryParams(b.query_params);
        if (queryA < queryB) return -1;
        if (queryA > queryB) return 1;

        return 0;
    });
    return mocks;
}

/**
 * Finds possible matches for a given method and path (ignoring query params)
 */
export function findPossibleMocks(method: string, requestPath: string): MockDefinition[] {
    const normalizedPath = normalizePath(requestPath);
    const possibleMatches: MockDefinition[] = [];
    for (const mock of mockDefinitions.values()) {
        if (mock.method === method.toUpperCase() && mock.path === normalizedPath) {
            possibleMatches.push(mock);
        }
    }
    return possibleMatches;
}
