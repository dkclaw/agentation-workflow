# Agentation Library Internals

Reference document for the Agentation library's internal architecture. Useful for debugging, extending, or building alternative integrations.

> Based on analysis of `agentation@2.2.1` bundled dist.

## localStorage Schema

Agentation persists annotations and sessions in `localStorage`:

### Annotations

- **Key pattern:** `feedback-annotations-{pathname}`
  - Example: `feedback-annotations-/` for the root page
  - Example: `feedback-annotations-/dashboard` for `/dashboard`
- **Value:** JSON array of annotation objects
- **Retention:** 7 days (`DEFAULT_RETENTION_DAYS = 7`). Annotations older than 7 days are filtered out on load.

### Sessions

- **Key pattern:** `agentation-session-{pathname}`
- **Value:** MCP session ID string (used when `mcpUrl` is configured)

### Settings

- `feedback-toolbar-settings` — JSON object with toolbar preferences
- `feedback-toolbar-theme` — Theme string
- `feedback-toolbar-position` — Toolbar position

### Freeze State

- `__agentation_freeze` — UI freeze state key

## Annotation Data Model

Each annotation object in localStorage:

```typescript
interface Annotation {
  id: number;                    // Timestamp-based ID (e.g., 1772757700008)
  x: number;                     // Click X coordinate
  y: number;                     // Click Y coordinate
  quote: string;                 // User's annotation comment
  element: string;               // Element description (e.g., 'button "Book a Demo"')
  description: string;           // Generated description
  timestamp: number;             // Creation timestamp (ms)

  // Element metadata (auto-captured)
  elementInfo: object;           // Basic element info
  boundingBox: object;           // Element bounding rect
  reactPath: string;             // React component tree path
  classInfo: object;             // CSS class information
  computedStyles: object;        // Computed CSS styles
  accessibilityInfo: object;     // ARIA/a11y attributes
  interactiveInfo: object;       // Interactive element details
  textContent: string;           // Element text content
  parentChain: object[];         // DOM parent chain

  // Multi-select
  multiSelectElements: object[]; // Multiple selected elements
  selectedElements: object[];    // Selected element references

  // Sync markers (when MCP is connected)
  serverAnnotationId?: string;   // ID on the MCP server
  sessionId?: string;            // MCP session ID
  _syncedTo?: string;            // Session sync marker
}
```

## Storage Functions (Internal)

```javascript
// From src/utils/storage.ts in the bundled dist:

getStorageKey(pathname)           // → `feedback-annotations-${pathname}`
loadAnnotations(pathname)         // Read + parse + filter expired
saveAnnotations(pathname, anns)   // JSON.stringify + setItem
loadAllAnnotations()              // Iterate all localStorage keys with prefix
saveAnnotationsWithSyncMarker(pathname, anns, sessionId)  // Add _syncedTo marker

getSessionStorageKey(pathname)    // → `agentation-session-${pathname}`
loadSessionId(pathname)           // Read session ID
saveSessionId(pathname, id)       // Write session ID
clearSessionId(pathname)          // Remove session ID
```

## MCP Server HTTP API

When `mcpUrl` is configured, the toolbar communicates with the MCP server:

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create a session (body: `{url}`) |
| `GET` | `/sessions/{id}` | Get session with annotations |
| `POST` | `/sessions/{id}/annotations` | Add/update annotation |
| `DELETE` | `/annotations/{id}` | Delete annotation by ID |
| `POST` | `/annotations/{id}/resolve` | Mark annotation as resolved |

### SSE Events (from MCP server)

The toolbar connects to the MCP server's SSE stream for real-time updates:

- `annotation.updated` — Annotation was modified server-side

## Webhook Payload

When `webhookUrl` + `autoSend` are set, annotations are POSTed:

```json
{
  "event": "annotation.add",
  "annotation": {
    "id": "1772757700008",
    "comment": "make this text red",
    "element": "paragraph: \"Hello World\"",
    "elementPath": ".container > .content > p",
    "reactComponents": "App > Layout > Content",
    "cssClasses": "text-gray-600, mb-4",
    "computedStyles": "color: rgb(75, 85, 99); ...",
    "selectedText": "Hello World"
  },
  "url": "http://localhost:3000/"
}
```

## React Component Internals

- Uses `useState` for annotations array (no external state management)
- Loads from localStorage on mount via `loadAnnotations(pathname)`
- Saves to localStorage on every annotation change
- **No public imperative API** — cannot programmatically add/remove annotations
- **Remount strategy:** Change the `key` prop to force unmount → remount → re-read localStorage
- Uses Shadow DOM for toolbar rendering (CSS isolation)
- WeakMap caching for React fiber detection (`componentCacheAll`)
- CSS modules with hash suffixes (e.g., `styles-module__toolbar___wNsdK`)

## Key Constants

```javascript
STORAGE_PREFIX = "feedback-annotations-"
SESSION_PREFIX = "agentation-session-"
DEFAULT_RETENTION_DAYS = 7
STATE_KEY = "__agentation_freeze"
```
