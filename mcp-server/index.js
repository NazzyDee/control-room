#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getUnresolvedMessages, getMessageDetails, resolveMessage } from './services/messages.js';

// Create a standard Model Context Protocol (MCP) server instance
const server = new McpServer({
  name: 'control-room-mcp-server',
  version: '1.0.0',
  description: 'ControlRoom MCP Server for querying and managing unresolved user feedback and tickets'
});

/**
 * Tool: get_unresolved_messages
 * Fetches all open, pending, or unresolved messages/tickets in ControlRoom.
 */
server.tool(
  'get_unresolved_messages',
  'Fetches all open, pending, or unresolved messages/tickets in ControlRoom with optional filtering by limit, priority, since timestamp, and app.',
  {
    limit: z.number().int().min(1).max(100).optional().describe('Maximum number of unresolved messages to retrieve (default: 20, max: 100)'),
    priority: z.string().optional().describe('Filter messages by priority level: e.g. "high", "medium", "low", "urgent"'),
    since: z.string().optional().describe('ISO 8601 timestamp string (e.g. "2026-08-01T00:00:00.000Z") to fetch messages created after this date/time'),
    app: z.string().optional().describe('Filter messages by specific application (e.g. "PlexMePlease", "Check It", "Pred: Know Your Stats", "Your Journey Your Tools")')
  },
  async ({ limit = 20, priority, since, app }) => {
    try {
      const data = await getUnresolvedMessages({ limit, priority, since, app });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: err.message }, null, 2)
          }
        ]
      };
    }
  }
);

/**
 * Tool: get_message_details
 * Retrieves the full context, history, and metadata of a specific message.
 */
server.tool(
  'get_message_details',
  'Retrieves the full context, complete message body, metadata, thread history, and tags for a specific message/ticket ID.',
  {
    message_id: z.string().min(1).describe('The unique identifier (document ID) of the message to retrieve')
  },
  async ({ message_id }) => {
    try {
      const data = await getMessageDetails(message_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: err.message }, null, 2)
          }
        ]
      };
    }
  }
);

/**
 * Tool: resolve_message
 * Marks a message as resolved with an optional resolution note.
 */
server.tool(
  'resolve_message',
  'Marks a message/ticket as resolved in ControlRoom with an optional resolution note and timestamp.',
  {
    message_id: z.string().min(1).describe('The unique identifier of the message to mark as resolved'),
    notes: z.string().optional().describe('Optional explanation, fix notes, or resolution summary')
  },
  async ({ message_id, notes }) => {
    try {
      const data = await resolveMessage(message_id, notes);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: err.message }, null, 2)
          }
        ]
      };
    }
  }
);

/**
 * Connect to standard stdio transport for MCP clients
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[ControlRoom MCP] Server running on stdio transport');
}

main().catch((err) => {
  console.error('[ControlRoom MCP] Fatal startup error:', err);
  process.exit(1);
});
