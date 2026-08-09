/**
 * JSON tool schemas for AI editor function calling (Agent B chat).
 * Import EDITOR_TOOL_SCHEMAS or individual tools; pair with helpers in editorSearch.ts.
 */

export type EditorToolJsonSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

/** HTTP endpoints that mirror these tools (auth required). */
export const EDITOR_SEARCH_ENDPOINTS = {
  librarySearch: {
    method: "GET",
    path: "/api/jobs/:jobId/editor/library-search",
    query: ["q", "person", "limit", "mediaType"],
  },
  webSearch: {
    method: "GET",
    path: "/api/jobs/:jobId/editor/web-search",
    query: ["q", "limit"],
    env: ["SEARCHAPI_API_KEY"],
  },
  libraryBrowse: {
    method: "GET",
    path: "/api/jobs/:jobId/editor/library-browse",
    query: ["person", "mediaType", "category", "limit", "offset"],
  },
} as const;

export const searchRoyalLibraryToolSchema: EditorToolJsonSchema = {
  type: "function",
  function: {
    name: "search_royal_library",
    description:
      "Search the royal media library for images or raw footage clips. Prefer this before web image search. Provide q and/or person. Returns assetId values safe to use in swap_visual.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        q: {
          type: "string",
          description: "Free-text search (person, place, category, description keywords). Required if person is omitted.",
        },
        person: {
          type: "string",
          description: "Optional person name or slug filter (e.g. King Charles, king-charles).",
        },
        mediaType: {
          type: "string",
          enum: ["image", "raw_footage"],
          description: "Optional media type filter.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Max results (default 20).",
        },
      },
    },
  },
};

export const searchWebImagesToolSchema: EditorToolJsonSchema = {
  type: "function",
  function: {
    name: "search_web_images",
    description:
      "Search Google Images via SearchAPI for external stills when the royal library has no good match. Requires SEARCHAPI_API_KEY. Do not invent URLs.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["q"],
      properties: {
        q: {
          type: "string",
          description: "Image search query.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Max results (default 8).",
        },
      },
    },
  },
};

export const browseRoyalLibraryToolSchema: EditorToolJsonSchema = {
  type: "function",
  function: {
    name: "browse_royal_library",
    description:
      "List royal library person tags and browse clips for a person/category. Use when the user asks what people or clips are available.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        person: {
          type: "string",
          description: "Optional person name or slug to browse.",
        },
        mediaType: {
          type: "string",
          enum: ["image", "raw_footage"],
        },
        category: {
          type: "string",
          description: "Optional category / tag substring filter.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 80,
          description: "Page size (default 24).",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Pagination offset (default 0).",
        },
      },
    },
  },
};

/** Schemas Agent B can pass to the model for function calling. */
export const EDITOR_TOOL_SCHEMAS: EditorToolJsonSchema[] = [
  searchRoyalLibraryToolSchema,
  searchWebImagesToolSchema,
  browseRoyalLibraryToolSchema,
];

/** Map tool name → server helper export name (for wiring docs). */
export const EDITOR_TOOL_HELPERS = {
  search_royal_library: "searchRoyalLibraryForEditor",
  search_web_images: "searchWebImagesForEditor",
  browse_royal_library: "browseRoyalLibraryForEditor",
} as const;
