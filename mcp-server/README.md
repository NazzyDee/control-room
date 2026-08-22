# ControlRoom Model Context Protocol (MCP) Server

A standard [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for **ControlRoom**. This server allows AI assistants (Antigravity, Claude Desktop, Cursor, Windsurf, Cline) to query, inspect, and manage unresolved user feedback, bugs, and tickets directly from the ControlRoom Firestore database.

---

## 🛠️ Available Tools

### 1. `get_unresolved_messages`
Fetches all open, pending, or unresolved feedback and tickets from ControlRoom.

**Parameters:**
| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `limit` | integer | No | `20` | Maximum number of messages to retrieve (1–100). |
| `priority` | string | No | `null` | Filter by priority level: e.g. `"high"`, `"medium"`, `"low"`, `"urgent"`. |
| `since` | string | No | `null` | ISO 8601 timestamp string (e.g. `"2026-08-01T00:00:00.000Z"`) to retrieve messages created after this date. |
| `app` | string | No | `null` | Filter messages by application name (e.g. `"PlexMePlease"`, `"Check It"`, `"Pred: Know Your Stats"`, `"Your Journey Your Tools"`). |

**Output Example:**
```json
{
  "count": 1,
  "total_retrieved": 1,
  "messages": [
    {
      "message_id": "kgTWjoIGveqXZETqwxcp",
      "app": "PlexMePlease",
      "sender": "user@example.com",
      "subject": "Playback error on iOS stream",
      "snippet": "Videos fail to buffer when switching between cellular and wifi...",
      "timestamp": "2026-08-22T07:24:00.000Z",
      "priority": "high",
      "status": "unresolved",
      "type": "bug"
    }
  ]
}
```

---

### 2. `get_message_details`
Retrieves the full context, complete message body, metadata, thread history, and tags for a specific message/ticket ID.

**Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | string | **Yes** | The document ID of the message to retrieve. |

**Output Example:**
```json
{
  "message_id": "kgTWjoIGveqXZETqwxcp",
  "app": "PlexMePlease",
  "sender": "user@example.com",
  "type": "bug",
  "priority": "high",
  "status": "unresolved",
  "subject": "Playback error on iOS stream",
  "message": "Videos fail to buffer when switching between cellular and wifi. Error code: 404 stream missing.",
  "timestamp": "2026-08-22T07:24:00.000Z",
  "resolvedAt": null,
  "resolutionNotes": null,
  "tags": [
    "bug",
    "PlexMePlease"
  ],
  "thread": [],
  "metadata": null
}
```

---

### 3. `resolve_message`
Marks a message/ticket as resolved in ControlRoom with an optional resolution note and timestamp.

**Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | string | **Yes** | The document ID of the message to mark as resolved. |
| `notes` | string | No | Optional explanation, fix notes, or resolution summary. |

**Output Example:**
```json
{
  "success": true,
  "message_id": "kgTWjoIGveqXZETqwxcp",
  "status": "resolved",
  "resolvedAt": "2026-08-22T07:24:03.617Z",
  "notes": "Fixed in patch v1.2.4"
}
```

---

## ⚙️ Configuration & Setup

### Environment Variables
The server automatically loads environment variables from the `.env` file in the project root:
- `GOOGLE_CLIENT_EMAIL`: Service account email (e.g. `firebase-adminsdk-fbsvc@your-journey-your-tools.iam.gserviceaccount.com`)
- `GOOGLE_PRIVATE_KEY`: Service account RSA private key
- `GOOGLE_PROJECT_ID`: (Optional, default: `your-journey-your-tools`)

---

### MCP Client Configurations

#### 1. Claude Desktop (`claude_desktop_config.json`)
On Windows: `%APPDATA%\Claude\claude_desktop_config.json`  
On macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "control-room": {
      "command": "node",
      "args": [
        "v:/New App Ideas/Work/Control Room/mcp-server/index.js"
      ]
    }
  }
}
```

#### 2. Antigravity / Cursor / Windsurf (`mcp.json`)
```json
{
  "mcpServers": {
    "control-room": {
      "command": "node",
      "args": [
        "v:/New App Ideas/Work/Control Room/mcp-server/index.js"
      ]
    }
  }
}
```

---

## 🧪 Testing

Run the automated integration test suite:
```bash
npm run mcp
# or run the test suite:
node mcp-server/test-server.js
node mcp-server/test-resolve.js
```
