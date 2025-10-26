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
} from "./types/gemini.js";
import { createPartFromUri } from "@google/genai";

const MODELS = {
  PRO: "gemini-2.5-pro",
  FLASH_25: "gemini-2.5-flash",
  FLASH_20: "gemini-2.0-flash-exp",
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