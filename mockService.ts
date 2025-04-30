import { Application } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import * as path from "std/path/mod.ts";
import { exists } from "std/fs/exists.ts";

const MOCKS_FILE = path.join(Deno.cwd(), "mocks.json");

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

    // Sort by key, then by value for stability if keys are identical (though unlikely with form data)
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
            // Parse string into URLSearchParams for consistent sorting/encoding
            sortedQueryString = encodeQueryParams(new URLSearchParams(query));
        } else if (query instanceof URLSearchParams) {
             sortedQueryString = encodeQueryParams(query);
        } else { // It's a Record<string, string>
            sortedQueryString = encodeQueryParams(query);
        }
    }

    return `${method.toUpperCase()}:${normalizedPath}:${sortedQueryString}`;
}

/**
 * Normalizes a path: ensures it starts with '/' and removes trailing '/'.
 */
function normalizePath(rawPath: string): string {
    let path = rawPath.trim();
    if (!path.startsWith('/')) {
        path = '/' + path;
    }
    if (path.length > 1 && path.endsWith('/')) {
        path = path.slice(0, -1);
    }
    // Handle the root path case
    if (path === '') return '/';
    return path;
}

/**
 * Loads mock definitions from JSON file into the Map.
 */
export async function loadMocks(): Promise<void> {
    mockDefinitions = new Map(); // Clear existing
    if (!await exists(MOCKS_FILE)) {
        console.log(`Mock file '${MOCKS_FILE}' not found. Starting with empty definitions.`);
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
            // Basic validation and defaults
            const method = mockData.method?.toUpperCase();
            const rawPath = mockData.path;
            const queryParams = mockData.query_params ?? {};

            if (method && rawPath) {
                const normalizedPath = normalizePath(rawPath); // Use normalized path
                const key = generateMockKey(method, normalizedPath, queryParams);

                const fullMock: MockDefinition = {
                    name: mockData.name ?? '',
                    path: normalizedPath, // Store normalized path
                    method: method,
                    query_params: queryParams,
                    status_code: mockData.status_code ?? 200,
                    content_type: mockData.content_type ?? 'application/json',
                    response_body: mockData.response_body ?? '',
                };

                mockDefinitions.set(key, fullMock);
                count++;
            } else {
                console.warn(`Skipping invalid mock entry: ${JSON.stringify(mockData)}`);
            }
        }
        console.log(`Loaded ${count} valid mocks from '${MOCKS_FILE}'.`);

    } catch (error) {
        console.error(`Error loading mocks from '${MOCKS_FILE}':`, error);
        // Optionally, start with an empty set or re-throw
        mockDefinitions = new Map();
    }
}

/**
 * Saves current mock definitions (Map values) to the JSON file.
 */
async function saveMocks(): Promise<void> {
    const mocksList = Array.from(mockDefinitions.values());
    try {
        await Deno.writeTextFile(MOCKS_FILE, JSON.stringify(mocksList, null, 2)); // Pretty print JSON
        console.log(`Saved ${mocksList.length} mocks to '${MOCKS_FILE}'.`);
    } catch (error) {
        console.error(`Error saving mocks to '${MOCKS_FILE}':`, error);
    }
}

/**
 * Adds or updates a mock definition.
 */
export async function addOrUpdateMock(data: Omit<MockDefinition, 'query_params'> & { query_string?: string }): Promise<void> {
    const method = data.method.toUpperCase();
    const normalizedPath = normalizePath(data.path);
    const queryParams = Object.fromEntries(new URLSearchParams(data.query_string ?? '').entries()); // Parse string to object

    const key = generateMockKey(method, normalizedPath, queryParams);

    const mockData: MockDefinition = {
        name: data.name.trim(),
        path: normalizedPath,
        method: method,
        query_params: queryParams, // Store as object
        status_code: data.status_code,
        content_type: data.content_type.trim(),
        response_body: data.response_body
    };

    mockDefinitions.set(key, mockData);
    console.log(`Upserted mock with key: ${key}`);
    await saveMocks();
}

/**
 * Deletes a mock definition based on method, path, and query string.
 */
export async function deleteMock(method: string, path: string, queryString: string): Promise<boolean> {
    const key = generateMockKey(method, path, queryString);
    if (mockDefinitions.has(key)) {
        mockDefinitions.delete(key);
        console.log(`Deleted mock with key: ${key}`);
        await saveMocks();
        return true;
    } else {
        console.warn(`Mock not found for deletion with key: ${key}`);
        return false;
    }
}

/**
 * Finds a mock definition matching the request details.
 * Tries exact match first (method, path, query params), then fallback (method, path, no query params).
 */
export function findMock(method: string, requestPath: string, queryParams: URLSearchParams): { mock: MockDefinition; matchType: 'Exact' | 'Fallback (Path Only)' } | null {
    const normalizedPath = normalizePath(requestPath);

    // 1. Try exact match
    const exactKey = generateMockKey(method, normalizedPath, queryParams);
    console.log(`  Attempting exact match lookup with key: ${exactKey}`);
    if (mockDefinitions.has(exactKey)) {
        console.log(`  Found exact match!`);
        return { mock: mockDefinitions.get(exactKey)!, matchType: 'Exact' };
    }

    // 2. Try fallback match (ignore query params if exact match failed)
    const fallbackKey = generateMockKey(method, normalizedPath, {}); // Empty query params for fallback key
    console.log(`  Exact match failed. Attempting fallback match with key: ${fallbackKey}`);
    if (mockDefinitions.has(fallbackKey)) {
        console.log(`  Found fallback match (mock defined for path without specific query params).`);
        return { mock: mockDefinitions.get(fallbackKey)!, matchType: 'Fallback (Path Only)' };
    }

    console.log(`  Fallback match also failed.`);
    return null;
}

/**
 * Gets all mock definitions, sorted for display.
 */
export function getAllMocksSorted(): MockDefinition[] {
    const mocks = Array.from(mockDefinitions.values());
    // Sort by name (case-insensitive), then path, method, query params string
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
 * Used for helpful 404 messages.
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
