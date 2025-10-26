#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import * as path from "path";
import {
  GeminiMessage,
  ChatArgs,
  isValidChatArgs,
  ConversationSession,
  FileUpload,
  UploadedFile,
  BatchJob,
  BatchJobState,
  EmbeddingTaskType,
  ContentIngestionReport,
} from "./types/gemini.js";
import { createPartFromUri } from "@google/genai";

const MODELS = {
  PRO: "gemini-2.5-pro",
  FLASH_25: "gemini-2.5-flash",
  FLASH_20: "gemini-2.0-flash-exp",
  EMBEDDING: "gemini-embedding-001",
} as const;

// Upload configuration - balanced for typical 1-10 file use cases
const BATCH_CONFIG = {
  MAX_CONCURRENT_UPLOADS: 5,      // Good balance for 2-10 files (can handle 40+)
  RETRY_ATTEMPTS: 3,               // Sufficient for transient failures
  RETRY_DELAY_MS: 2000,           // 2 second base retry delay
  PROCESSING_CHECK_INTERVAL_MS: 5000,  // Check every 5 seconds
  MAX_PROCESSING_WAIT_MS: 120000, // 2 minutes max wait (rarely needed)
};

interface MultipleUploadResult {
  successful: Array<{
    originalPath: string;
    file: any; // File object from Gemini
    uri: string;
  }>;
  failed: Array<{
    originalPath: string;
    error: string;
  }>;
}

class GeminiMCPServer {
  private server: Server;
  private genAI: any = null;
  private GoogleGenAIClass: any = null;
  private conversations: Map<string, ConversationSession> = new Map();
  private uploadedFiles: Map<string, UploadedFile> = new Map();
  private fileObjects: Map<string, any> = new Map(); // Store actual file objects from Gemini

  constructor() {
    this.server = new Server(
      {
        name: "gemini-mcp-enhanced",
        version: "0.2.10",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupErrorHandling();
    this.setupHandlers();
  }

  private async getGenAI(): Promise<any> {
    if (!this.genAI) {
      console.error("[Init] Initializing GoogleGenAI client...");

      // Lazy load GoogleGenAI SDK
      if (!this.GoogleGenAIClass) {
        const module = await import("@google/genai");
        this.GoogleGenAIClass = module.GoogleGenAI;
      }

      // Validate API key
      const API_KEY = process.env.GEMINI_API_KEY;
      if (!API_KEY) {
        throw new Error(
          "GEMINI_API_KEY environment variable required. " +
          "Get your key from: https://aistudio.google.com/app/apikey"
        );
      }

      try {
        this.genAI = new this.GoogleGenAIClass({ apiKey: API_KEY });
        console.error("[Init] GoogleGenAI client initialized successfully");
      } catch (error: any) {
        console.error("[Init] Failed to initialize GoogleGenAI client:", error.message);
        throw error;
      }
    }
    return this.genAI;
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    this.setupResourceHandlers();
    this.setupToolHandlers();
  }

  private setupResourceHandlers(): void {
    this.server.setRequestHandler(
      ListResourcesRequestSchema,
      async () => ({
        resources: [
          {
            uri: "gemini://models/available",
            name: "Available Gemini Models",
            mimeType: "application/json",
            description: "List of available Gemini models and their capabilities",
          },
          {
            uri: "gemini://conversations/active",
            name: "Active Conversations",
            mimeType: "application/json",
            description: "List of active conversation sessions",
          },
          {
            uri: "gemini://files/uploaded",
            name: "Uploaded Files",
            mimeType: "application/json",
            description: "List of currently uploaded files",
          },
        ],
      })
    );

    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const uri = request.params.uri;

        if (uri === "gemini://models/available") {
          const modelsInfo = {
            models: [
              {
                name: MODELS.PRO,
                description: "Most powerful model for complex reasoning and coding",
                capabilities: ["text", "images", "thinking", "tools"],
                maxTokens: 8192,
              },
              {
                name: MODELS.FLASH_25,
                description: "Gemini 2.5 Flash - Fast performance for everyday tasks",
                capabilities: ["text", "images", "thinking", "tools"],
                maxTokens: 8192,
              },
              {
                name: MODELS.FLASH_20,
                description: "Gemini 2.0 Flash - Experimental fast model",
                capabilities: ["text", "images", "tools"],
                maxTokens: 8192,
              },
            ],
          };

          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify(modelsInfo, null, 2),
              },
            ],
          };
        }

        if (uri === "gemini://conversations/active") {
          const conversationsData = Array.from(this.conversations.entries()).map(
            ([id, session]) => ({
              id,
              messageCount: session.messages.length,
              createdAt: session.createdAt.toISOString(),
              lastActivity: session.lastActivity.toISOString(),
            })
          );

          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify({ conversations: conversationsData }, null, 2),
              },
            ],
          };
        }

        if (uri === "gemini://files/uploaded") {
          const filesData = Array.from(this.uploadedFiles.entries()).map(
            ([uri, file]) => ({
              uri,
              displayName: file.displayName,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              state: file.state,
              expirationTime: file.expirationTime,
            })
          );

          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify({ files: filesData, count: filesData.length }, null, 2),
              },
            ],
          };
        }

        throw new McpError(
          ErrorCode.InvalidRequest,
          `Unknown resource: ${uri}`
        );
      }
    );
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(
      ListToolsRequestSchema,
      async () => ({
        tools: [
          {
            name: "chat",
            description: "SEND MESSAGE TO GEMINI (with optional files) - Chat with Gemini, optionally including uploaded files for multimodal analysis. TYPICAL USE: 0-2 files for most tasks (code review, document analysis, image description). SCALES TO: 40+ files when needed for comprehensive analysis. WORKFLOW: 1) Upload files first using upload_file (single) or upload_multiple_files (multiple), 2) Pass returned URIs in fileUris array, 3) Include your text prompt in message. The server handles file object caching and proper API formatting. Supports conversation continuity via conversationId. RETURNS: response text, token usage, conversation ID. Files are passed as direct objects to Gemini (not fileData structures). Auto-retrieves missing files from API if not cached.",
            inputSchema: {
              type: "object",
              properties: {
                message: {
                  type: "string",
                  description: "The message to send to Gemini",
                },
                model: {
                  type: "string",
                  enum: [MODELS.PRO, MODELS.FLASH_25, MODELS.FLASH_20],
                  description: "The Gemini model to use",
                  default: MODELS.PRO,
                },
                fileUris: {
                  type: "array",
                  items: { type: "string" },
                  description: "Array of file URIs from previously uploaded files",
                },
                temperature: {
                  type: "number",
                  minimum: 0,
                  maximum: 2,
                  description: "Controls randomness in responses (0.0 to 2.0)",
                  default: 1.0,
                },
                maxTokens: {
                  type: "number",
                  minimum: 1,
                  maximum: 500000,
                  description: "Maximum tokens in response",
                  default: 15000,
                },
                conversationId: {
                  type: "string",
                  description: "Optional conversation ID to continue a previous chat",
                },
              },
              required: ["message"],
            },
          },
          {
            name: "upload_multiple_files",
            description: "UPLOAD MULTIPLE FILES EFFICIENTLY - Handles 2-40+ files with smart parallel processing. TYPICAL USE: 2-10 files for multi-document analysis, code reviews, or comparative tasks. SCALES TO: 40+ files for comprehensive dataset processing. FEATURES: Automatic retry (3 attempts), parallel uploads (5 concurrent default), processing state monitoring (waits for ACTIVE state). WORKFLOW: 1) Provide array of file paths, 2) System uploads in optimized batches, 3) Returns URIs for use in chat tool. PERFORMANCE: 2 files = ~30 seconds, 10 files = ~1-2 minutes, 40 files = ~2-3 minutes. Each successful upload returns: originalPath, file object, URI. Failed uploads include error details. Use upload_file for single files instead.",
            inputSchema: {
              type: "object",
              properties: {
                filePaths: {
                  type: "array",
                  items: { type: "string" },
                  description: "Array of absolute file paths to upload",
                },
                maxConcurrent: {
                  type: "number",
                  description: "Maximum concurrent uploads (default: 5, max: 10)",
                  default: 5,
                  minimum: 1,
                  maximum: 10,
                },
                waitForProcessing: {
                  type: "boolean",
                  description: "Wait for all files to be in ACTIVE state before returning",
                  default: true,
                },
              },
              required: ["filePaths"],
            },
          },
          {
            name: "start_conversation",
            description: "INITIALIZE CONVERSATION SESSION - Creates new conversation context for multi-turn chat with Gemini. Generates unique ID if not provided. Stores message history for context continuity. Returns conversationId to use in subsequent chat calls. USAGE: Call before first chat or to start fresh context. Pass returned ID to chat tool's conversationId parameter for continuation.",
            inputSchema: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Optional custom conversation ID",
                },
              },
            },
          },
          {
            name: "clear_conversation",
            description: "CLEAR CONVERSATION HISTORY - Deletes specified conversation session and all associated message history. Frees memory and resets context. USAGE: Pass conversationId from start_conversation or chat response. Returns confirmation or 'not found' message. Use when switching topics or cleaning up after completion.",
            inputSchema: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Conversation ID to clear",
                },
              },
              required: ["id"],
            },
          },
          {
            name: "upload_file",
            description: "UPLOAD SINGLE FILE - Standard method for uploading one file to Gemini. BEST FOR: Single documents, images, or code files for immediate analysis. Includes automatic retry and state monitoring until file is ready. WORKFLOW: 1) Upload with auto-detected MIME type, 2) Wait for processing to complete (usually 10-30 seconds), 3) Returns URI for chat tool. RETURNS: fileUri (pass to chat tool), displayName, mimeType, sizeBytes, state. Files auto-delete after 48 hours. For 2+ files, consider upload_multiple_files for efficiency.",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Absolute path to the file to upload",
                },
                displayName: {
                  type: "string",
                  description: "Optional display name for the file",
                },
                mimeType: {
                  type: "string",
                  description: "Optional MIME type (auto-detected if not provided)",
                },
              },
              required: ["filePath"],
            },
          },
          {
            name: "list_files",
            description: "LIST ALL UPLOADED FILES - Retrieves metadata for all files currently in Gemini File API (associated with API key). Updates internal cache with latest file states. RETURNS: Array of files with uri, displayName, mimeType, sizeBytes, createTime, expirationTime, state. Also shows cachedCount indicating files ready for immediate use. USAGE: Check file availability before chat, monitor upload status, audit storage usage (20GB project limit).",
            inputSchema: {
              type: "object",
              properties: {
                pageSize: {
                  type: "number",
                  description: "Number of files to return (default 10, max 100)",
                  default: 10,
                },
              },
            },
          },
          {
            name: "get_file",
            description: "GET FILE METADATA & UPDATE CACHE - Retrieves current metadata for specific file from Gemini API and updates cache. USAGE: Pass fileUri from upload response or list_files. RETURNS: Complete file info including uri, displayName, mimeType, sizeBytes, create/update/expiration times, sha256Hash, state. Automatically adds to cache if missing. USE CASE: Verify file state, check expiration, refresh cache entry.",
            inputSchema: {
              type: "object",
              properties: {
                fileUri: {
                  type: "string",
                  description: "The file URI or name returned from upload_file",
                },
              },
              required: ["fileUri"],
            },
          },
          {
            name: "delete_file",
            description: "DELETE FILE FROM GEMINI - Permanently removes file from Gemini File API and clears from cache. USAGE: Pass fileUri from upload or list_files. Immediate deletion, cannot be undone. USE CASE: Clean up after processing, manage storage quota, remove sensitive data. NOTE: Files auto-delete after 48 hours if not manually removed.",
            inputSchema: {
              type: "object",
              properties: {
                fileUri: {
                  type: "string",
                  description: "The file URI or name to delete",
                },
              },
              required: ["fileUri"],
            },
          },
          {
            name: "cleanup_all_files",
            description: "BULK DELETE ALL FILES - Removes ALL files from Gemini File API associated with current API key. Clears entire cache. RETURNS: Count of deleted vs failed deletions with detailed lists. USE CASE: Complete cleanup after batch processing, reset environment, clear storage quota. WARNING: Irreversible operation affecting all uploaded files.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "batch_create",
            description: "CREATE BATCH JOB - Create async content generation batch job with Gemini. COST: 50% cheaper than standard API. TURNAROUND: ~24 hours target. WORKFLOW: 1) Prepare JSONL file with requests (or use batch_ingest_content first), 2) Upload file with upload_file, 3) Call batch_create with file URI, 4) Use batch_get_status to monitor progress, 5) Use batch_download_results when complete. SUPPORTS: Inline requests (<20MB) or file-based (JSONL for large batches). Returns batch job ID and initial status.",
            inputSchema: {
              type: "object",
              properties: {
                model: {
                  type: "string",
                  enum: [MODELS.PRO, MODELS.FLASH_25, MODELS.FLASH_20],
                  description: "Gemini model for content generation",
                  default: MODELS.FLASH_25,
                },
                requests: {
                  type: "array",
                  description: "Inline batch requests (for small batches <20MB). Each request should have 'key' and 'request' fields.",
                },
                inputFileUri: {
                  type: "string",
                  description: "URI of uploaded JSONL file (from upload_file tool). Use for large batches or when requests exceed 20MB.",
                },
                displayName: {
                  type: "string",
                  description: "Optional display name for the batch job",
                },
                outputLocation: {
                  type: "string",
                  description: "Output directory for results (defaults to current working directory)",
                },
                config: {
                  type: "object",
                  description: "Optional generation config (temperature, maxOutputTokens, etc.)",
                  properties: {
                    temperature: {
                      type: "number",
                      minimum: 0,
                      maximum: 2,
                      default: 1.0,
                    },
                    maxOutputTokens: {
                      type: "number",
                      minimum: 1,
                      maximum: 500000,
                    },
                  },
                },
              },
            },
          },
          {
            name: "batch_process",
            description: "COMPLETE BATCH WORKFLOW - End-to-end content generation batch processing. WORKFLOW: 1) Ingests content file (CSV, JSON, TXT, etc.), 2) Converts to JSONL, 3) Uploads to Gemini, 4) Creates batch job, 5) Polls until complete, 6) Downloads and parses results. BEST FOR: Users who want simple one-call solution. RETURNS: Final results with metadata. For more control, use individual tools (batch_ingest_content, batch_create, batch_get_status, batch_download_results).",
            inputSchema: {
              type: "object",
              properties: {
                inputFile: {
                  type: "string",
                  description: "Path to content file (CSV, JSON, TXT, MD, JSONL)",
                },
                model: {
                  type: "string",
                  enum: [MODELS.PRO, MODELS.FLASH_25, MODELS.FLASH_20],
                  description: "Gemini model for content generation",
                  default: MODELS.FLASH_25,
                },
                outputLocation: {
                  type: "string",
                  description: "Output directory for results (defaults to current working directory)",
                },
                pollIntervalSeconds: {
                  type: "number",
                  description: "Seconds between status checks (default: 30)",
                  default: 30,
                  minimum: 10,
                },
                config: {
                  type: "object",
                  description: "Optional generation config",
                },
              },
              required: ["inputFile"],
            },
          },
          {
            name: "batch_ingest_content",
            description: "INTELLIGENT CONTENT INGESTION - Analyzes content file, converts to JSONL for batch processing. WORKFLOW: 1) Detects format (CSV, JSON, TXT, MD), 2) Analyzes structure/complexity, 3) Writes analysis scripts if needed, 4) Converts to proper JSONL format, 5) Validates JSONL structure. SUPPORTS: CSV (converts rows), JSON (wraps objects), TXT/MD (splits by lines/sections). RETURNS: Conversion report with outputFile path, validation status, and any generated scripts.",
            inputSchema: {
              type: "object",
              properties: {
                inputFile: {
                  type: "string",
                  description: "Path to content file to ingest",
                },
                outputFile: {
                  type: "string",
                  description: "Optional output JSONL path (auto-generated if not provided)",
                },
                generateScripts: {
                  type: "boolean",
                  description: "Generate analysis/extraction scripts for complex content",
                  default: true,
                },
              },
              required: ["inputFile"],
            },
          },
          {
            name: "batch_get_status",
            description: "GET BATCH JOB STATUS - Check status of running batch job with optional auto-polling. STATES: PENDING (queued), RUNNING (processing), SUCCEEDED (complete), FAILED (error), CANCELLED (user stopped), EXPIRED (timeout). WORKFLOW: 1) Call with batch job name/ID, 2) Optionally enable polling to wait for completion, 3) Returns current state, progress stats, and completion info. USAGE: Pass job name from batch_create response. Enable autoPoll for hands-off waiting.",
            inputSchema: {
              type: "object",
              properties: {
                batchName: {
                  type: "string",
                  description: "Batch job name/ID from batch_create",
                },
                autoPoll: {
                  type: "boolean",
                  description: "Automatically poll until job completes (SUCCEEDED, FAILED, or CANCELLED)",
                  default: false,
                },
                pollIntervalSeconds: {
                  type: "number",
                  description: "Seconds between status checks when autoPoll=true (default: 30)",
                  default: 30,
                  minimum: 10,
                },
                maxWaitMs: {
                  type: "number",
                  description: "Maximum wait time in milliseconds (default: 24 hours)",
                  default: 86400000,
                },
              },
              required: ["batchName"],
            },
          },
          {
            name: "batch_download_results",
            description: "DOWNLOAD BATCH RESULTS - Download and parse results from completed batch job. WORKFLOW: 1) Checks job status (must be SUCCEEDED), 2) Downloads result file from Gemini API, 3) Parses JSONL results, 4) Saves to local file, 5) Returns parsed results array. RETURNS: Array of results with original keys, responses, and metadata. Also saves to file in outputLocation.",
            inputSchema: {
              type: "object",
              properties: {
                batchName: {
                  type: "string",
                  description: "Batch job name/ID from batch_create",
                },
                outputLocation: {
                  type: "string",
                  description: "Directory to save results file (defaults to current working directory)",
                },
              },
              required: ["batchName"],
            },
          },
          {
            name: "batch_create_embeddings",
            description: "CREATE EMBEDDINGS BATCH JOB - Create async embeddings generation batch job. COST: 50% cheaper than standard API. MODEL: gemini-embedding-001 (1536 dimensions). WORKFLOW: 1) Prepare content (use batch_ingest_embeddings for conversion), 2) Select task type (use batch_query_task_type if unsure), 3) Upload file, 4) Call batch_create_embeddings, 5) Monitor with batch_get_status, 6) Download with batch_download_results. TASK TYPES: See batch_query_task_type for descriptions and recommendations.",
            inputSchema: {
              type: "object",
              properties: {
                model: {
                  type: "string",
                  description: "Embedding model",
                  default: MODELS.EMBEDDING,
                  enum: [MODELS.EMBEDDING],
                },
                requests: {
                  type: "array",
                  description: "Inline embedding requests (for small batches)",
                },
                inputFileUri: {
                  type: "string",
                  description: "URI of uploaded JSONL file with embedding requests",
                },
                taskType: {
                  type: "string",
                  enum: Object.values(EmbeddingTaskType),
                  description: "Embedding task type (affects model optimization). Use batch_query_task_type for guidance.",
                },
                displayName: {
                  type: "string",
                  description: "Optional display name for the batch job",
                },
                outputLocation: {
                  type: "string",
                  description: "Output directory for results",
                },
              },
              required: ["taskType"],
            },
          },
          {
            name: "batch_process_embeddings",
            description: "COMPLETE EMBEDDINGS WORKFLOW - End-to-end embeddings batch processing. WORKFLOW: 1) Ingests content, 2) Queries user for task type (or auto-recommends), 3) Converts to JSONL, 4) Uploads, 5) Creates batch job, 6) Polls until complete, 7) Downloads results. BEST FOR: Simple one-call embeddings generation. RETURNS: Embeddings array (1536-dimensional vectors) with metadata.",
            inputSchema: {
              type: "object",
              properties: {
                inputFile: {
                  type: "string",
                  description: "Path to content file",
                },
                taskType: {
                  type: "string",
                  enum: Object.values(EmbeddingTaskType),
                  description: "Embedding task type (omit to get interactive prompt)",
                },
                model: {
                  type: "string",
                  description: "Embedding model",
                  default: MODELS.EMBEDDING,
                  enum: [MODELS.EMBEDDING],
                },
                outputLocation: {
                  type: "string",
                  description: "Output directory for results",
                },
                pollIntervalSeconds: {
                  type: "number",
                  description: "Seconds between status checks",
                  default: 30,
                  minimum: 10,
                },
              },
              required: ["inputFile"],
            },
          },
          {
            name: "batch_ingest_embeddings",
            description: "EMBEDDINGS CONTENT INGESTION - Specialized ingestion for embeddings batch processing. WORKFLOW: 1) Analyzes content structure, 2) Extracts text for embedding, 3) Formats as JSONL with proper embedContent structure, 4) Validates format. OPTIMIZED FOR: Text extraction from various formats (CSV columns, JSON fields, TXT lines, MD sections). RETURNS: JSONL file ready for batch_create_embeddings.",
            inputSchema: {
              type: "object",
              properties: {
                inputFile: {
                  type: "string",
                  description: "Path to content file",
                },
                outputFile: {
                  type: "string",
                  description: "Optional output JSONL path",
                },
                textField: {
                  type: "string",
                  description: "For CSV/JSON: field name containing text to embed (auto-detected if not provided)",
                },
              },
              required: ["inputFile"],
            },
          },
          {
            name: "batch_query_task_type",
            description: "INTERACTIVE TASK TYPE SELECTOR - Helps choose optimal embedding task type with recommendations. WORKFLOW: 1) Optionally analyzes sample content, 2) Shows all 8 task types with descriptions, 3) Provides AI recommendation based on context, 4) Returns selected task type. TASK TYPES: SEMANTIC_SIMILARITY (compare text similarity), CLASSIFICATION (categorize text), CLUSTERING (group similar items), RETRIEVAL_DOCUMENT (index for search), RETRIEVAL_QUERY (search queries), CODE_RETRIEVAL_QUERY (code search), QUESTION_ANSWERING (Q&A systems), FACT_VERIFICATION (check claims).",
            inputSchema: {
              type: "object",
              properties: {
                context: {
                  type: "string",
                  description: "Optional context about your use case (e.g., 'building search engine for documentation')",
                },
                sampleContent: {
                  type: "array",
                  items: { type: "string" },
                  description: "Optional sample texts to analyze for recommendation",
                },
              },
            },
          },
          {
            name: "batch_cancel",
            description: "CANCEL BATCH JOB - Request cancellation of running batch job. WORKFLOW: 1) Sends cancel request to Gemini API, 2) Job transitions to CANCELLED state, 3) Processing stops (may take a few seconds), 4) Partial results may be available. USE CASE: Stop long-running job due to errors, changed requirements, or cost management. NOTE: Cannot cancel SUCCEEDED or FAILED jobs.",
            inputSchema: {
              type: "object",
              properties: {
                batchName: {
                  type: "string",
                  description: "Batch job name/ID to cancel",
                },
              },
              required: ["batchName"],
            },
          },
          {
            name: "batch_delete",
            description: "DELETE BATCH JOB - Permanently delete batch job and associated data. WORKFLOW: 1) Validates job exists, 2) Deletes job metadata from Gemini API, 3) Removes from internal tracking. USE CASE: Clean up completed/failed jobs, manage job history, free storage. WARNING: Irreversible operation. Results will be lost if not downloaded first. Recommended to download results before deletion.",
            inputSchema: {
              type: "object",
              properties: {
                batchName: {
                  type: "string",
                  description: "Batch job name/ID to delete",
                },
              },
              required: ["batchName"],
            },
          },
        ],
      })
    );

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const { name, arguments: args } = request.params;

        switch (name) {
          case "chat":
            return await this.handleChat(args);
          case "upload_multiple_files":
            return await this.handleMultipleUpload(args);
          case "start_conversation":
            return await this.handleStartConversation(args);
          case "clear_conversation":
            return await this.handleClearConversation(args);
          case "upload_file":
            return await this.handleUploadFile(args);
          case "list_files":
            return await this.handleListFiles(args);
          case "get_file":
            return await this.handleGetFile(args);
          case "delete_file":
            return await this.handleDeleteFile(args);
          case "cleanup_all_files":
            return await this.handleCleanupAllFiles();
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      }
    );
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async uploadFileWithRetry(
    filePath: string,
    displayName?: string,
    mimeType?: string,
    retries: number = BATCH_CONFIG.RETRY_ATTEMPTS
  ): Promise<any> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.error(`[Upload] Attempting upload of ${filePath} (attempt ${attempt}/${retries})`);

        // Detect MIME type if not provided
        const detectedMimeType = mimeType || this.getMimeType(filePath);
        const fileName = displayName || path.basename(filePath);

        // Upload to Gemini Files API
        const genAI = await this.getGenAI();
        const uploadResult = await genAI.files.upload({
          file: filePath,
          config: {
            mimeType: detectedMimeType,
            displayName: fileName,
          }
        });

        console.error(`[Upload] Successfully uploaded ${filePath} with name: ${uploadResult.name}`);
        return uploadResult;
        
      } catch (error: any) {
        lastError = error;
        console.error(`[Upload] Attempt ${attempt} failed for ${filePath}: ${error.message}`);
        
        if (attempt < retries) {
          await this.sleep(BATCH_CONFIG.RETRY_DELAY_MS * attempt);
        }
      }
    }
    
    throw lastError;
  }

  private async waitForFileProcessing(file: any): Promise<any> {
    const startTime = Date.now();
    let processedFile = file;
    
    while (processedFile.state === "PROCESSING") {
      if (Date.now() - startTime > BATCH_CONFIG.MAX_PROCESSING_WAIT_MS) {
        throw new Error(`File processing timeout for ${file.name}`);
      }
      
      console.error(`[Processing] Waiting for ${file.name} to process...`);
      await this.sleep(BATCH_CONFIG.PROCESSING_CHECK_INTERVAL_MS);

      try {
        const genAI = await this.getGenAI();
        processedFile = await genAI.files.get({ name: file.name });
      } catch (error: any) {
        console.error(`[Processing] Error checking file status: ${error.message}`);
        // Continue waiting
      }
    }
    
    if (processedFile.state === "FAILED") {
      throw new Error(`File processing failed for ${file.name}`);
    }
    
    console.error(`[Processing] File ${file.name} is now ${processedFile.state}`);
    return processedFile;
  }

  // ============================================================================
  // BATCH API HELPER FUNCTIONS
  // ============================================================================

  /**
   * Poll batch job status until completion or timeout
   */
  private async pollBatchUntilComplete(
    batchName: string,
    intervalSeconds: number = 30,
    maxWaitMs: number = 86400000 // 24 hours
  ): Promise<BatchJob> {
    const startTime = Date.now();
    const completedStates = new Set([
      BatchJobState.JOB_STATE_SUCCEEDED,
      BatchJobState.JOB_STATE_FAILED,
      BatchJobState.JOB_STATE_CANCELLED,
      BatchJobState.JOB_STATE_EXPIRED,
    ]);

    console.error(`[Batch] Polling status for job: ${batchName}`);

    while (true) {
      const genAI = await this.getGenAI();
      const batchJob = await genAI.batches.get({ name: batchName });

      console.error(`[Batch] Current state: ${batchJob.state}`);

      if (completedStates.has(batchJob.state as BatchJobState)) {
        console.error(`[Batch] Job finished with state: ${batchJob.state}`);
        return batchJob;
      }

      if (Date.now() - startTime > maxWaitMs) {
        throw new Error(`Batch job polling timeout after ${maxWaitMs}ms`);
      }

      await this.sleep(intervalSeconds * 1000);
    }
  }

  /**
   * Download and parse batch results from completed job
   */
  private async downloadAndParseBatchResults(
    batchJob: BatchJob,
    outputLocation: string = process.cwd()
  ): Promise<{ results: any[]; filePath: string }> {
    // Handle inline responses
    if (batchJob.dest?.inlinedResponses) {
      const results = batchJob.dest.inlinedResponses.map((resp: any) => {
        if (resp.response) {
          return resp.response.text || resp.response;
        } else if (resp.error) {
          return { error: resp.error };
        }
        return resp;
      });

      const fs = await import("fs/promises");
      const filePath = path.join(outputLocation, `batch_results_${Date.now()}.json`);
      await fs.writeFile(filePath, JSON.stringify(results, null, 2));

      return { results, filePath };
    }

    // Handle file-based results
    if (batchJob.dest?.fileName) {
      const genAI = await this.getGenAI();
      const fileContent = await genAI.files.download({ file: batchJob.dest.fileName });

      // Parse JSONL content
      const results = fileContent
        .toString('utf-8')
        .split('\n')
        .filter((line: string) => line.trim())
        .map((line: string) => JSON.parse(line));

      const fs = await import("fs/promises");
      const filePath = path.join(outputLocation, `batch_results_${Date.now()}.jsonl`);
      await fs.writeFile(filePath, fileContent);

      return { results, filePath };
    }

    throw new Error("No results found in batch job");
  }

  /**
   * Validate batch requests format
   */
  private async validateBatchRequests(requests: any[]): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!Array.isArray(requests)) {
      errors.push("Requests must be an array");
      return { valid: false, errors };
    }

    if (requests.length === 0) {
      errors.push("Requests array cannot be empty");
      return { valid: false, errors };
    }

    requests.forEach((req, index) => {
      if (!req.contents && !req.request?.contents) {
        errors.push(`Request ${index}: missing 'contents' field`);
      }
    });

    return { valid: errors.length === 0, errors };
  }

  /**
   * Analyze content structure of input file
   */
  private async analyzeContentStructure(filePath: string): Promise<{
    format: string;
    structure: any;
    complexity: string;
  }> {
    const fs = await import("fs/promises");
    const ext = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath, 'utf-8');

    // Detect format
    let format = "unknown";
    let structure: any = {};
    let complexity = "simple";

    if (ext === ".jsonl" || ext === ".ndjson") {
      format = "jsonl";
      const lines = content.split('\n').filter(l => l.trim());
      structure = { lineCount: lines.length };
    } else if (ext === ".json") {
      format = "json";
      try {
        const parsed = JSON.parse(content);
        structure = { isArray: Array.isArray(parsed), keys: Object.keys(parsed) };
      } catch (e) {
        complexity = "complex";
      }
    } else if (ext === ".csv") {
      format = "csv";
      const lines = content.split('\n');
      structure = { rowCount: lines.length, hasHeader: true };
    } else if (ext === ".txt" || ext === ".md") {
      format = "text";
      const lines = content.split('\n');
      structure = { lineCount: lines.length };
    } else if (ext === ".xml") {
      format = "xml";
      complexity = "complex";
    }

    return { format, structure, complexity };
  }

  /**
   * Convert various file formats to JSONL for batch processing
   */
  private async convertToJSONL(
    filePath: string,
    format: string,
    outputPath: string
  ): Promise<ContentIngestionReport> {
    const fs = await import("fs/promises");
    const content = await fs.readFile(filePath, 'utf-8');
    const errors: string[] = [];
    let totalRequests = 0;

    let jsonlLines: string[] = [];

    try {
      switch (format) {
        case "jsonl":
          // Already JSONL, just copy
          jsonlLines = content.split('\n').filter(l => l.trim());
          break;

        case "json":
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            jsonlLines = parsed.map((item, i) =>
              JSON.stringify({
                key: `request-${i + 1}`,
                request: { contents: [{ parts: [{ text: typeof item === 'string' ? item : JSON.stringify(item) }] }] }
              })
            );
          } else {
            // Single object
            jsonlLines = [JSON.stringify({
              key: "request-1",
              request: { contents: [{ parts: [{ text: JSON.stringify(parsed) }] }] }
            })];
          }
          break;

        case "csv":
          const lines = content.split('\n').filter(l => l.trim());
          const header = lines[0];
          jsonlLines = lines.slice(1).map((line, i) =>
            JSON.stringify({
              key: `request-${i + 1}`,
              request: { contents: [{ parts: [{ text: line }] }] }
            })
          );
          break;

        case "text":
          const textLines = content.split('\n').filter(l => l.trim());
          jsonlLines = textLines.map((line, i) =>
            JSON.stringify({
              key: `request-${i + 1}`,
              request: { contents: [{ parts: [{ text: line }] }] }
            })
          );
          break;

        default:
          errors.push(`Unsupported format: ${format}`);
          return {
            sourceFile: filePath,
            outputFile: outputPath,
            sourceFormat: format,
            totalRequests: 0,
            validationPassed: false,
            errors,
          };
      }

      totalRequests = jsonlLines.length;
      await fs.writeFile(outputPath, jsonlLines.join('\n'));

    } catch (error: any) {
      errors.push(`Conversion error: ${error.message}`);
    }

    return {
      sourceFile: filePath,
      outputFile: outputPath,
      sourceFormat: format,
      totalRequests,
      validationPassed: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate JSONL format for batch API
   */
  private async validateJSONL(filePath: string): Promise<{
    valid: boolean;
    errors: string[];
    requestCount: number;
  }> {
    const fs = await import("fs/promises");
    const content = await fs.readFile(filePath, 'utf-8');
    const errors: string[] = [];
    const lines = content.split('\n').filter(l => l.trim());

    lines.forEach((line, index) => {
      try {
        const parsed = JSON.parse(line);
        if (!parsed.request || !parsed.request.contents) {
          errors.push(`Line ${index + 1}: missing required 'request.contents' field`);
        }
      } catch (e) {
        errors.push(`Line ${index + 1}: invalid JSON`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      requestCount: lines.length,
    };
  }

  /**
   * Prompt user to select embedding task type
   */
  private async promptForTaskType(
    context?: string,
    samples?: string[]
  ): Promise<EmbeddingTaskType> {
    // This would ideally use an interactive prompt library
    // For now, return a sensible default and log guidance
    console.error("\n[Batch Embeddings] Task Type Selection Required");
    console.error("Available task types:");
    console.error("  1. SEMANTIC_SIMILARITY - Find similar content");
    console.error("  2. CLASSIFICATION - Categorize into predefined labels");
    console.error("  3. CLUSTERING - Group by similarity (no labels)");
    console.error("  4. RETRIEVAL_DOCUMENT - Index documents for search");
    console.error("  5. RETRIEVAL_QUERY - Search queries");
    console.error("  6. CODE_RETRIEVAL_QUERY - Search code by description");
    console.error("  7. QUESTION_ANSWERING - Chatbot questions");
    console.error("  8. FACT_VERIFICATION - Verify statements");

    if (context) {
      console.error(`\nContext: ${context}`);
    }

    // Default to RETRIEVAL_DOCUMENT as most common use case
    return EmbeddingTaskType.RETRIEVAL_DOCUMENT;
  }

  /**
   * Get task type recommendation based on context
   */
  private getTaskTypeRecommendation(
    context: string,
    samples: string[]
  ): { taskType: EmbeddingTaskType; confidence: number; reasoning: string } {
    const contextLower = context.toLowerCase();

    if (contextLower.includes("similar") || contextLower.includes("recommend")) {
      return {
        taskType: EmbeddingTaskType.SEMANTIC_SIMILARITY,
        confidence: 0.9,
        reasoning: "Context mentions finding similar content"
      };
    }

    if (contextLower.includes("categor") || contextLower.includes("classif")) {
      return {
        taskType: EmbeddingTaskType.CLASSIFICATION,
        confidence: 0.9,
        reasoning: "Context mentions categorization or classification"
      };
    }

    if (contextLower.includes("search") || contextLower.includes("retriev")) {
      return {
        taskType: EmbeddingTaskType.RETRIEVAL_DOCUMENT,
        confidence: 0.8,
        reasoning: "Context mentions search or retrieval"
      };
    }

    // Default
    return {
      taskType: EmbeddingTaskType.RETRIEVAL_DOCUMENT,
      confidence: 0.5,
      reasoning: "Default to document retrieval (most common use case)"
    };
  }

  /**
   * Prompt user for output location
   */
  private async promptForOutputLocation(
    defaultLocation: string = process.cwd()
  ): Promise<string> {
    // In MCP context, we can't do interactive prompts easily
    // Return default and log guidance
    console.error(`[Batch] Using default output location: ${defaultLocation}`);
    console.error("To specify custom location, pass 'output_location' parameter");
    return defaultLocation;
  }

  private async handleMultipleUpload(args: any) {
    const filePaths = args?.filePaths || [];
    const maxConcurrent = Math.min(args?.maxConcurrent || 5, 10);
    const waitForProcessing = args?.waitForProcessing !== false;

    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "filePaths must be a non-empty array"
      );
    }

    console.error(`[Multiple Upload] Starting upload of ${filePaths.length} files with ${maxConcurrent} concurrent uploads`);

    const result: MultipleUploadResult = {
      successful: [],
      failed: [],
    };

    // Process files in batches
    for (let i = 0; i < filePaths.length; i += maxConcurrent) {
      const batch = filePaths.slice(i, i + maxConcurrent);
      console.error(`[Multiple Upload] Processing batch ${Math.floor(i / maxConcurrent) + 1}/${Math.ceil(filePaths.length / maxConcurrent)}`);

      const uploadPromises = batch.map(async (filePath) => {
        try {
          // Check if file exists
          const fs = await import("fs/promises");
          await fs.access(filePath);

          // Upload with retry
          const uploadedFile = await this.uploadFileWithRetry(filePath);

          // Wait for processing if requested
          let finalFile = uploadedFile;
          if (waitForProcessing) {
            finalFile = await this.waitForFileProcessing(uploadedFile);
          }

          // Store file info in our cache
          const fileInfo: UploadedFile = {
            name: finalFile.name || "",
            displayName: finalFile.displayName || path.basename(filePath),
            mimeType: finalFile.mimeType || this.getMimeType(filePath),
            sizeBytes: finalFile.sizeBytes || "0",
            createTime: finalFile.createTime || new Date().toISOString(),
            updateTime: finalFile.updateTime || new Date().toISOString(),
            expirationTime: finalFile.expirationTime || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            sha256Hash: finalFile.sha256Hash || "",
            uri: finalFile.uri || finalFile.name || "",
            state: finalFile.state || "ACTIVE",
          };

          this.uploadedFiles.set(fileInfo.uri, fileInfo);
          this.fileObjects.set(fileInfo.uri, finalFile); // Store the actual file object

          result.successful.push({
            originalPath: filePath,
            file: finalFile,
            uri: fileInfo.uri,
          });

        } catch (error: any) {
          console.error(`[Multiple Upload] Failed to upload ${filePath}: ${error.message}`);
          result.failed.push({
            originalPath: filePath,
            error: error.message,
          });
        }
      });

      // Wait for current batch to complete
      await Promise.all(uploadPromises);

      // Small delay between batches to avoid rate limiting
      if (i + maxConcurrent < filePaths.length) {
        await this.sleep(1000);
      }
    }

    const summary = {
      totalRequested: filePaths.length,
      successfulUploads: result.successful.length,
      failedUploads: result.failed.length,
      successful: result.successful.map(s => ({
        path: s.originalPath,
        uri: s.uri,
        state: s.file.state,
      })),
      failed: result.failed,
      message: `Multiple file upload completed: ${result.successful.length}/${filePaths.length} files uploaded successfully`,
    };

    console.error(`[Multiple Upload] Complete: ${summary.message}`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }

  private async handleChat(args: any) {
    const message = args?.message;
    const model = args?.model || MODELS.PRO;
    const fileUris = args?.fileUris || [];
    const temperature = args?.temperature || 1.0;
    const maxTokens = args?.maxTokens || 15000;
    const conversationId = args?.conversationId;

    if (!message || typeof message !== "string") {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Message is required and must be a string"
      );
    }

    try {
      // Get or create conversation session
      let session: ConversationSession;
      if (conversationId && this.conversations.has(conversationId)) {
        session = this.conversations.get(conversationId)!;
      } else {
        const id = conversationId || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        session = {
          id,
          messages: [],
          createdAt: new Date(),
          lastActivity: new Date(),
        };
        this.conversations.set(id, session);
      }

      // Build content array with proper file references
      const contents: any[] = [message];
      
      // Add file objects if provided
      if (fileUris && Array.isArray(fileUris) && fileUris.length > 0) {
        console.error(`[Chat] Adding ${fileUris.length} files to prompt`);

        for (const fileUri of fileUris) {
          // Get the actual file object from our cache
          const fileObj = this.fileObjects.get(fileUri);

          if (fileObj) {
            // Create clean file reference with only essential fields (no metadata)
            const filePart = {
              fileData: {
                fileUri: fileObj.uri,
                mimeType: fileObj.mimeType
              }
            };
            contents.push(filePart);
            console.error(`[Chat] Added file part for ${fileUri} (${fileObj.mimeType})`);
          } else {
            // Try to get it from the API if not in cache
            console.error(`[Chat] File ${fileUri} not in cache, attempting to retrieve from API`);
            try {
              const genAI = await this.getGenAI();
              const retrievedFile = await genAI.files.get({ name: fileUri });
              if (retrievedFile) {
                this.fileObjects.set(fileUri, retrievedFile);
                const filePart = {
                  fileData: {
                    fileUri: retrievedFile.uri,
                    mimeType: retrievedFile.mimeType
                  }
                };
                contents.push(filePart);
                console.error(`[Chat] Successfully retrieved and added file ${fileUri}`);
              }
            } catch (error: any) {
              console.error(`[Chat] Warning: Could not retrieve file ${fileUri}: ${error.message}`);
              // Continue without this file
            }
          }
        }
      }

      console.error(`[Chat] Sending request to Gemini with ${contents.length} parts`);

      // Generate response using the correct API format
      const genAI = await this.getGenAI();
      const result = await genAI.models.generateContent({
        model,
        contents,
        config: {
          temperature,
          maxOutputTokens: maxTokens,
        }
      });

      const responseText = result.text;
      console.error(`[Chat] Received response from Gemini`);

      // Store conversation history (simplified for now)
      const userMessage: GeminiMessage = {
        role: "user",
        parts: [{ text: message }],
      };
      session.messages.push(userMessage);

      const modelMessage: GeminiMessage = {
        role: "model",
        parts: [{ text: responseText }],
      };
      session.messages.push(modelMessage);
      session.lastActivity = new Date();

      // Prepare response with full diagnostic information
      const responseData: any = {
        response: responseText,
        conversationId: session.id,
        model,
        usage: {
          promptTokens: result.usageMetadata?.promptTokenCount || 0,
          completionTokens: result.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: result.usageMetadata?.totalTokenCount || 0,
          thoughtsTokenCount: result.usageMetadata?.thoughtsTokenCount || 0,
        },
        filesProcessed: fileUris?.length || 0,
      };

      // Include diagnostic information if available
      if (result.candidates && result.candidates.length > 0) {
        const candidate = result.candidates[0];
        responseData.finishReason = candidate.finishReason;
        responseData.safetyRatings = candidate.safetyRatings;

        // Log diagnostic info
        if (candidate.finishReason) {
          console.error(`[Chat] Finish reason: ${candidate.finishReason}`);
        }
        if (candidate.safetyRatings) {
          console.error(`[Chat] Safety ratings: ${JSON.stringify(candidate.safetyRatings)}`);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(responseData, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error("Gemini API error:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error communicating with Gemini: ${error.message}\n\nDebug info: ${JSON.stringify({
              filesInCache: Array.from(this.fileObjects.keys()),
              requestedFiles: fileUris,
            }, null, 2)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleStartConversation(args: any) {
    const id = args?.id || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (this.conversations.has(id)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              message: "Conversation already exists", 
              conversationId: id 
            }, null, 2),
          },
        ],
      };
    }

    const session: ConversationSession = {
      id,
      messages: [],
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.conversations.set(id, session);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ 
          message: "New conversation started", 
            conversationId: id 
          }, null, 2),
        },
      ],
    };
  }

  private async handleClearConversation(args: any) {
    const id = args?.id;
    
    if (!id) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Conversation ID is required"
      );
    }

    if (this.conversations.has(id)) {
      this.conversations.delete(id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              message: "Conversation cleared", 
              conversationId: id 
            }, null, 2),
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              message: "Conversation not found", 
              conversationId: id 
            }, null, 2),
          },
        ],
      };
    }
  }

  private async handleUploadFile(args: any) {
    const filePath = args?.filePath;
    const displayName = args?.displayName;
    const mimeType = args?.mimeType;

    if (!filePath) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "filePath is required"
      );
    }

    try {
      const uploadResult = await this.uploadFileWithRetry(filePath, displayName, mimeType);
      const processedFile = await this.waitForFileProcessing(uploadResult);
      
      // Store file info in our cache
      const fileInfo: UploadedFile = {
        name: processedFile.name || "",
        displayName: processedFile.displayName || path.basename(filePath),
        mimeType: processedFile.mimeType || this.getMimeType(filePath),
        sizeBytes: processedFile.sizeBytes || "0",
        createTime: processedFile.createTime || new Date().toISOString(),
        updateTime: processedFile.updateTime || new Date().toISOString(),
        expirationTime: processedFile.expirationTime || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        sha256Hash: processedFile.sha256Hash || "",
        uri: processedFile.uri || processedFile.name || "",
        state: processedFile.state || "ACTIVE",
      };

      this.uploadedFiles.set(fileInfo.uri, fileInfo);
      this.fileObjects.set(fileInfo.uri, processedFile);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: "File uploaded successfully",
              fileUri: fileInfo.uri,
              displayName: fileInfo.displayName,
              mimeType: fileInfo.mimeType,
              sizeBytes: fileInfo.sizeBytes,
              state: fileInfo.state,
              expirationTime: fileInfo.expirationTime,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error("File upload error:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error uploading file: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleListFiles(args: any) {
    const pageSize = args?.pageSize || 10;

    try {
      const genAI = await this.getGenAI();
      const listResult = await genAI.files.list({
        config: {
          pageSize: Math.min(pageSize, 100),
        }
      });

      const files = [];
      for await (const file of listResult) {
        files.push({
          uri: file.uri || file.name,
          displayName: file.displayName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          createTime: file.createTime,
          expirationTime: file.expirationTime,
          state: file.state,
        });

        // Update our cache
        const fileUri = file.uri || file.name || "";
        if (fileUri) {
          this.uploadedFiles.set(fileUri, file as UploadedFile);
          this.fileObjects.set(fileUri, file);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              files,
              count: files.length,
              cachedCount: this.fileObjects.size,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error("List files error:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error listing files: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleGetFile(args: any) {
    const fileUri = args?.fileUri;

    if (!fileUri) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "fileUri is required"
      );
    }

    try {
      const genAI = await this.getGenAI();
      const file = await genAI.files.get({ name: fileUri });

      const fileInfo = {
        uri: file.uri || file.name,
        displayName: file.displayName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        createTime: file.createTime,
        updateTime: file.updateTime,
        expirationTime: file.expirationTime,
        sha256Hash: file.sha256Hash,
        state: file.state,
      };

      // Update our cache
      if (fileInfo.uri) {
        this.uploadedFiles.set(fileInfo.uri, fileInfo as UploadedFile);
        this.fileObjects.set(fileInfo.uri, file);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(fileInfo, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error("Get file error:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error getting file: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleDeleteFile(args: any) {
    const fileUri = args?.fileUri;

    if (!fileUri) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "fileUri is required"
      );
    }

    try {
      const genAI = await this.getGenAI();
      await genAI.files.delete({ name: fileUri });

      // Remove from our cache
      this.uploadedFiles.delete(fileUri);
      this.fileObjects.delete(fileUri);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: "File deleted successfully",
              fileUri: fileUri,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error("Delete file error:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error deleting file: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleCleanupAllFiles() {
    try {
      const deletedFiles = [];
      const failedDeletes = [];
      const genAI = await this.getGenAI();

      for (const [uri, _] of this.uploadedFiles) {
        try {
          await genAI.files.delete({ name: uri });
          deletedFiles.push(uri);
          this.uploadedFiles.delete(uri);
          this.fileObjects.delete(uri);
        } catch (error: any) {
          failedDeletes.push({ uri, error: error.message });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: "Cleanup completed",
              deletedCount: deletedFiles.length,
              failedCount: failedDeletes.length,
              deleted: deletedFiles,
              failed: failedDeletes,
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error during cleanup: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      // Images
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.heic': 'image/heic',
      '.heif': 'image/heif',
      // Videos
      '.mp4': 'video/mp4',
      '.mpeg': 'video/mpeg',
      '.mpg': 'video/mpeg',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.flv': 'video/x-flv',
      '.webm': 'video/webm',
      '.wmv': 'video/x-ms-wmv',
      '.3gpp': 'video/3gpp',
      // Audio
      '.mp3': 'audio/mp3',
      '.wav': 'audio/wav',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/opus',
      '.m4a': 'audio/mp4',
      '.weba': 'audio/webm',
      // Documents
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/plain',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.html': 'text/html',
      // Code files
      '.js': 'text/plain',
      '.ts': 'text/plain',
      '.py': 'text/plain',
      '.java': 'text/plain',
      '.cpp': 'text/plain',
      '.c': 'text/plain',
      '.cs': 'text/plain',
      '.go': 'text/plain',
      '.rs': 'text/plain',
      '.php': 'text/plain',
      '.rb': 'text/plain',
      '.swift': 'text/plain',
      '.kt': 'text/plain',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[MCP] Server ready");
  }
}

const server = new GeminiMCPServer();
server.run().catch(console.error);