# Gemini MCP Server - Technical Documentation

## Project Overview

**Name:** gemini-mcp
**Version:** 0.4.0
**Type:** Model Context Protocol (MCP) Server
**Purpose:** Provides MCP-compliant interface to Google's Gemini AI models including **Gemini 3 Pro** (default), Gemini 2.5 Pro, Gemini 2.5 Flash, and image generation models (Gemini 3 Pro Image, Gemini 2.5 Flash Image) with advanced file handling, conversation management, and multimodal capabilities.

**Key Value Proposition:**
- **Gemini 3 Support:** Default to Google's most intelligent model with state-of-the-art reasoning and multimodal understanding
- **Image Generation:** Text-to-image and image editing with Gemini 3 Pro Image (default) or Gemini 2.5 Flash Image
- Enables Claude Desktop and other MCP clients to leverage Gemini's thinking models and extended context windows
- Handles complex file upload workflows including batch processing, retry logic, and state monitoring
- Manages conversation sessions with full history tracking
- Supports multimodal interactions (text, images, documents, audio, video)
- **Simple npx Installation:** Works with `npx @mintmcqueen/gemini-mcp@latest` - no global install required

---

## Architecture

### High-Level Component Flow

```
MCP Client (Claude Desktop)
    ↓
StdioServerTransport (stdin/stdout communication)
    ↓
MCP Server (Server class from @modelcontextprotocol/sdk)
    ↓
GeminiMCPServer (Custom implementation)
    ├── Resource Handlers (gemini://models/available, gemini://conversations/active, gemini://files/uploaded)
    ├── Tool Handlers (chat, generate_images, upload_file, batch_upload_files, list_files, get_file, delete_file, cleanup_all_files)
    └── State Management (conversations Map, uploadedFiles Map, fileObjects Map)
        ↓
GoogleGenAI SDK (@google/genai)
    ↓
Gemini API (Google's REST API)
```

### Core Components

#### 1. **GeminiMCPServer Class** (src/index.ts:59-1138)
Main server orchestration class that manages:
- MCP protocol compliance via `@modelcontextprotocol/sdk`
- Request routing to appropriate handlers
- Internal state (conversations, uploaded files, file objects)
- Error handling and graceful shutdown

**Key Properties:**
- `server: Server` - MCP SDK server instance
- `genAI: GoogleGenAI` - Google GenAI SDK client
- `conversations: Map<string, ConversationSession>` - Active conversation sessions with message history
- `uploadedFiles: Map<string, UploadedFile>` - File metadata cache (uri → metadata)
- `fileObjects: Map<string, any>` - Actual Gemini file objects cache (uri → file object)

#### 2. **Resource Handlers** (src/index.ts:101-218)
Provide read-only access to server state:
- `gemini://models/available` - List of supported Gemini models with capabilities
- `gemini://conversations/active` - Active conversation sessions with message counts and timestamps
- `gemini://files/uploaded` - Currently uploaded files with expiration times and states

#### 3. **Tool Handlers** (src/index.ts:220-430)
Implement MCP tools that clients can invoke:

**Core Tools:**
- `chat` (src/index.ts:609-738) - Send messages to Gemini with optional file attachments
- `generate_images` (src/index.ts:2906-3066) - Generate or edit images using Gemini 2.5 Flash Image model
- `upload_file` (src/index.ts:817-878) - Upload single file with retry and processing wait
- `batch_upload_files` (src/index.ts:505-607) - Upload 2-40+ files in parallel with progress tracking

**Conversation Tools:**
- `start_conversation` (src/index.ts:740-777) - Initialize new conversation session
- `clear_conversation` (src/index.ts:779-815) - Delete conversation and free memory

**File Management Tools:**
- `list_files` (src/index.ts:880-934) - List all uploaded files from Gemini API
- `get_file` (src/index.ts:936-987) - Get metadata for specific file
- `delete_file` (src/index.ts:989-1029) - Remove file from Gemini API
- `cleanup_all_files` (src/index.ts:1031-1072) - Bulk delete all uploaded files

#### 4. **File Upload System** (src/index.ts:436-503)

**Key Functions:**
- `uploadFileWithRetry()` (src/index.ts:436-475) - Uploads file with exponential backoff retry (3 attempts, 2s base delay)
- `waitForFileProcessing()` (src/index.ts:477-503) - Polls file state until ACTIVE or timeout (2 min max)

**Configuration** (src/index.ts:39-45):
```typescript
const BATCH_CONFIG = {
  MAX_CONCURRENT_UPLOADS: 5,      // Balance speed and rate limits
  RETRY_ATTEMPTS: 3,               // Handle transient API failures
  RETRY_DELAY_MS: 2000,           // Exponential backoff base
  PROCESSING_CHECK_INTERVAL_MS: 5000,  // Poll every 5 seconds
  MAX_PROCESSING_WAIT_MS: 120000, // 2 minute timeout per file
};
```

**File States:**
- `PROCESSING` → File uploaded but not yet ready for use
- `ACTIVE` → File ready for use in chat requests
- `FAILED` → Processing failed, file unusable

#### 5. **Conversation Management**
Each conversation session contains:
```typescript
interface ConversationSession {
  id: string;                    // Unique identifier
  messages: GeminiMessage[];     // Full message history (user + model)
  createdAt: Date;               // Session creation timestamp
  lastActivity: Date;            // Last message timestamp
}
```

Messages are stored as:
```typescript
interface GeminiMessage {
  role: "user" | "model";
  parts: Array<{
    text?: string;                    // Text content
    inlineData?: {                    // Base64 inline data (legacy)
      mimeType: string;
      data: string;
    }
  }>;
}
```

---

## Dependencies

### Production Dependencies

**1. @modelcontextprotocol/sdk** (^1.17.2)
- **Purpose:** Core MCP protocol implementation
- **Usage:** Server, transport, schemas, error types
- **Key Imports:**
  - `Server` - Main server class (src/index.ts:1)
  - `StdioServerTransport` - stdin/stdout communication (src/index.ts:2)
  - Request schemas: `ListResourcesRequestSchema`, `ReadResourceRequestSchema`, `ListToolsRequestSchema`, `CallToolRequestSchema`
  - Error handling: `ErrorCode`, `McpError`

**2. @google/genai** (^1.13.0)
- **Purpose:** Official Google Generative AI SDK
- **Usage:** Gemini API client, file operations
- **Key Classes:**
  - `GoogleGenAI` - Main client initialization (src/index.ts:11)
  - `genAI.models.generateContent()` - Text generation with multimodal support
  - `genAI.files.*` - File upload, list, get, delete operations
  - `createPartFromUri()` - Helper for file references

**3. zod** (^3.24.1)
- **Purpose:** Runtime type validation
- **Usage:** Schema validation for MCP tool arguments
- **Status:** Imported but not heavily utilized (opportunity for improvement)

**4. dotenv** (^16.4.7)
- **Purpose:** Environment variable management
- **Usage:** Load `.env` file for GEMINI_API_KEY (src/index.ts:25)

### Development Dependencies

**1. typescript** (^5.7.2)
- **Purpose:** Type-safe development and compilation
- **Config:** tsconfig.json (target: ES2022, module: ESNext)

**2. @types/node** (^22.10.2)
- **Purpose:** Node.js type definitions
- **Usage:** fs/promises, path modules

**3. nodemon** (^3.1.9)
- **Purpose:** Development auto-reload
- **Usage:** `npm run dev` script

---

## Directory Structure

```
gemini-mcp/
├── src/
│   ├── index.ts                  # Main MCP server implementation
│   └── types/
│       └── gemini.ts             # TypeScript interfaces for Gemini types
│
├── build/                        # Compiled JavaScript output (ESM)
│   ├── index.js                  # Compiled server (executable)
│   └── types/
│       └── gemini.js
│
├── node_modules/                 # Dependencies
├── genaidocs/                    # Reference documentation (Gemini API research)
│
├── package.json                  # NPM package configuration
├── package-lock.json             # Locked dependency versions
├── tsconfig.json                 # TypeScript compiler configuration
│
├── .env                          # Environment variables (GEMINI_API_KEY)
├── .env.example                  # Template for environment setup
├── .gitignore                    # Git exclusions
├── .npmignore                    # NPM packaging exclusions
│
├── README.md                     # User-facing documentation
├── ENHANCEMENTS.md               # Technical enhancement documentation
├── CLAUDE.md                     # This file - technical reference
├── LICENSE                       # MIT License
│
└── claude_desktop_config.example.json  # Example MCP server config
```

---

## Implementation Features

The server provides a comprehensive MCP interface to Gemini with the following capabilities:

**Core Features:**
- **Image Generation:** Text-to-image and image editing with 10 aspect ratios (1:1 to 21:9)
- **Batch Image Generation:** Sequential API calls for 1-4 images (~10-15s per image)
- Batch file upload for 2-40+ files with parallel processing
- Automatic retry with exponential backoff for reliability
- File processing state monitoring (PROCESSING → ACTIVE)
- Dual caching: metadata + actual file objects for performance
- Conversation management with full message history
- Complete file lifecycle management (upload, list, get, delete, cleanup)

**File Handling:**
- Passes file objects directly to `generateContent()` for proper multimodal support
- Maintains `fileObjects` Map for instant file object retrieval (src/index.ts:64, 558, 648-670)
- Automatically retrieves missing files from API if not cached (src/index.ts:656-668)
- Supports 40+ MIME types (images, video, audio, documents, code)

**Performance:**
- 2 files: ~30 seconds
- 10 files: 1-2 minutes
- 40 files: 2-3 minutes
- Parallel processing with configurable concurrency (default: 5)

---

## Key Code References

### 1. Chat with Files
**Location:** src/index.ts:609-738

**Critical Pattern:**
```typescript
// Build content array with file objects (not fileData)
const contents: any[] = [message];

for (const fileUri of fileUris) {
  const fileObj = this.fileObjects.get(fileUri);
  if (fileObj) {
    contents.push(fileObj);  // Direct file object
  } else {
    // Fallback: retrieve from API
    const retrievedFile = await this.genAI.files.get({ name: fileUri });
    this.fileObjects.set(fileUri, retrievedFile);
    contents.push(retrievedFile);
  }
}

// Send to Gemini
const result = await this.genAI.models.generateContent({
  model,
  contents,  // Simple array: [message, fileObj1, fileObj2, ...]
  config: { temperature, maxOutputTokens }
});
```

**Why This Works:**
- Google GenAI SDK expects file objects, not `fileData` structures
- Direct file objects maintain all metadata and API references
- Caching prevents redundant API calls

### 2. Image Generation
**Location:** src/index.ts:2906-3066

**Critical Pattern:**
```typescript
// Build request contents (with optional input image for editing)
const contents: any[] = [];

if (inputImageUri) {
  const fileObj = this.fileObjects.get(inputImageUri);
  contents.push({
    fileData: {
      fileUri: fileObj.uri,
      mimeType: fileObj.mimeType,
    },
  });
}

contents.push(prompt);

// Generate images using Gemini API
const result = await genAI.models.generateContent({
  model: "gemini-2.5-flash-image",
  contents,
  config: {
    temperature,
    responseModalities: ["Image"],
    imageConfig: {
      aspectRatio,
    },
  },
});

// Extract and save images
for (const candidate of result.candidates) {
  for (const part of candidate.content.parts) {
    if (part.inlineData) {
      const base64Data = part.inlineData.data;
      const buffer = Buffer.from(base64Data, "base64");
      await fs.writeFile(filePath, buffer);

      // Only include file path - exclude base64Data to avoid token limits
      images.push({
        mimeType: part.inlineData.mimeType,
        filePath,
        aspectRatio,
        index: images.length,
      });
    }
  }
}
```

**Key Features:**
- **Text-to-Image**: Generate new images from text descriptions
- **Image Editing**: Modify existing images with natural language instructions
- **Batch Generation**: Create 1-4 images per request (sequential API calls)
- **Aspect Ratios**: 10 supported ratios (1:1, 16:9, 9:16, etc.)
- **File-Based Output**: Auto-save to disk only (no base64 in response to avoid token limits)
- **Cost**: ~1,290-1,300 tokens per image (regardless of size up to 1024×1024)

**Implementation Note:** The Gemini API only supports one image per `generateContent()` call. When `numImages > 1`, the handler makes sequential API calls in a loop (src/index.ts:2985-3036) to generate multiple images.

**Helper Function:**
- `getMimeTypeExtension()` (src/index.ts:3068-3077) - Maps MIME types to file extensions

### 3. Batch Upload
**Location:** src/index.ts:505-607

**Workflow:**
1. Validate input (non-empty array of file paths)
2. Process files in batches of `maxConcurrent` (default 5)
3. For each file:
   - Check file existence (`fs.access()`)
   - Upload with retry (`uploadFileWithRetry()`)
   - Wait for processing if requested (`waitForFileProcessing()`)
   - Cache metadata and file object
4. Return summary with successful/failed arrays

**Error Handling:**
- Per-file try-catch (partial batch success)
- Detailed error messages in failed array
- Continues processing remaining files after failures

### 3. File State Monitoring
**Location:** src/index.ts:477-503

**Logic:**
```typescript
while (processedFile.state === "PROCESSING") {
  if (Date.now() - startTime > MAX_PROCESSING_WAIT_MS) {
    throw new Error(`File processing timeout`);
  }
  await sleep(PROCESSING_CHECK_INTERVAL_MS);
  processedFile = await this.genAI.files.get({ name: file.name });
}

if (processedFile.state === "FAILED") {
  throw new Error(`File processing failed`);
}
```

**Purpose:**
- Ensures files are ACTIVE before use in chat
- Prevents "file not ready" errors
- Configurable timeout prevents infinite loops

### 4. MIME Type Detection
**Location:** src/index.ts:1074-1128

**Supported Types:**
- Images: PNG, JPEG, GIF, WebP, HEIC, HEIF
- Videos: MP4, MPEG, AVI, MOV, FLV, WebM, WMV, 3GPP
- Audio: MP3, WAV, AAC, FLAC, OGG, Opus, M4A
- Documents: PDF, TXT, MD, CSV, JSON, XML, HTML
- Code: JS, TS, PY, Java, C++, C#, Go, Rust, PHP, Ruby, Swift, Kotlin

---

## Development Workflow

### Setup
1. Clone repository
2. Copy `.env.example` to `.env`
3. Add `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/app/apikey)
4. Install dependencies: `npm install`
5. Build: `npm run build`

### Development
- **Watch mode:** `npm run watch` (rebuilds on file changes)
- **Dev mode:** `npm run dev` (watch + auto-restart with nodemon)
- **Inspector:** `npm run inspector` (debug with MCP Inspector)

### Testing
- Manual testing via Claude Desktop with MCP server configuration
- Test files previously used (now removed for clean package):
  - test-mcp-simple.mjs - Basic chat test
  - test-mcp-multifile.mjs - Multiple file upload test
  - test-mcp-progressive.mjs - Batch upload test
  - batch-upload-simulation.ts - Comprehensive 40-file test

### Building
```bash
npm run build
```
- Compiles TypeScript → JavaScript (ESM)
- Output: `build/` directory
- Includes source maps and type declarations

---

## Configuration

### API Key Setup

**Get Your API Key:**
1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create a new API key (free)
3. Copy your key (starts with "AIza...")

**Installation Methods:**

**Option 1: NPX (Recommended - No Install)**
```bash
claude mcp add gemini -s user --env GEMINI_API_KEY=YOUR_KEY -- npx -y @mintmcqueen/gemini-mcp@latest
```

**Option 2: Global Install**
```bash
npm install -g @mintmcqueen/gemini-mcp
claude mcp add gemini -s user --env GEMINI_API_KEY=YOUR_KEY -- gemini-mcp
```

**Option 3: Local Project Install**
```bash
npm install @mintmcqueen/gemini-mcp
claude mcp add gemini -s project --env GEMINI_API_KEY=YOUR_KEY -- node node_modules/@mintmcqueen/gemini-mcp/build/index.js
```

**Key Points:**
- NPX requires `@latest` suffix for scoped packages to work correctly
- `-s` is shorthand for `--scope`
- `--transport stdio` is not needed (auto-detected)
- Restart Claude Code after adding the server

### Environment Variables
```bash
GEMINI_API_KEY=your-api-key-here  # Required - from Google AI Studio
```

### Claude Code Configuration (stdio MCP)
File: `~/.claude.json` (user scope) or `.mcp.json` (project scope)
```json
{
  "mcpServers": {
    "gemini": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/gemini-mcp/build/index.js"],
      "env": {
        "GEMINI_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**MCP Scopes:**
- **user**: `~/.claude.json` - Available across all your projects (default for install)
- **project**: `.mcp.json` - Shared with team via version control
- **local**: `.claude/settings.local.json` - Private to you in current project

### Claude Desktop Configuration
File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
```json
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": ["/absolute/path/to/gemini-mcp/build/index.js"],
      "env": {
        "GEMINI_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Important:**
- Use absolute path to build output
- API key can be set in config or loaded from environment
- Claude Code requires `type: "stdio"`, Claude Desktop does not

---

## API Limits & Considerations

### Gemini API Limits
- **File Storage:** 20GB total per project
- **File Size:** Maximum 2GB per file
- **File Retention:** 48 hours (auto-delete)
- **Rate Limits:** Subject to Google's API quotas
- **Context Window:** 1,048,576 tokens input (Gemini 2.5 Pro/Flash)

### Best Practices
1. **File Cleanup:** Use `cleanup_all_files` after batch processing
2. **Conversation Management:** Clear old conversations to free memory
3. **Batch Sizing:** Keep batches ≤40 files for optimal performance
4. **Error Handling:** Check file state before use in chat
5. **Retry Logic:** Built-in retry handles transient failures
6. **Cost Monitoring:** Track token usage from response metadata

---

## Known Issues & Solutions

### Issue 1: "Gemini cannot access files"
**Symptom:** Files upload successfully but Gemini returns empty/error responses
**Cause:** Incorrect file data structure passed to API
**Solution:** Server implementation correctly passes file objects directly to `generateContent()`

### Issue 2: File stuck in PROCESSING
**Symptom:** File never reaches ACTIVE state
**Cause:** Large files or temporary API issues
**Solution:** Adjust `MAX_PROCESSING_WAIT_MS` or implement skip logic for stuck files

### Issue 3: Rate limit exceeded
**Symptom:** Upload failures with rate limit errors
**Cause:** Too many concurrent uploads
**Solution:** Reduce `maxConcurrent` parameter in batch_upload_files

---

## Security Considerations

1. **API Key Protection:**
   - Never commit `.env` file
   - Use environment variables or config file with restricted permissions
   - Rotate keys if exposed

2. **File Content:**
   - Files uploaded to Gemini's servers (48-hour retention)
   - Consider data sensitivity before upload
   - Use `delete_file` or `cleanup_all_files` for immediate removal

3. **Conversation Data:**
   - Stored in server memory (not persisted to disk)
   - Cleared on server restart
   - Use `clear_conversation` to explicitly remove sensitive data

---

## Future Enhancements

### Potential Improvements
1. **Persistent Conversations:** Save to disk for server restarts
2. **Advanced Zod Validation:** Strict runtime type checking for tool arguments
3. **Streaming Support:** Enable streaming responses for long generations
4. **Tool Calling:** Implement Gemini's function calling capabilities
5. **Multi-User Support:** Namespace conversations by user/session
6. **Metrics & Logging:** Track usage, costs, and performance
7. **File Format Validation:** Pre-upload checks for supported MIME types
8. **Progressive Upload Feedback:** Real-time progress updates during batch uploads

### Considered But Not Implemented
- **Local File Caching:** Gemini API handles caching, redundant locally
- **Conversation Export:** Low priority, can be built externally
- **WebSocket Transport:** MCP clients use stdio, not needed yet

---

## Maintenance Notes

### Before Each Commit
1. Update this CLAUDE.md with any architectural changes
2. Add code references for new functions/classes
3. Document new dependencies with purpose and version
4. Update Known Issues if bugs discovered/fixed

### Version Bumping
- **Patch (0.2.x):** Bug fixes, no breaking changes
- **Minor (0.x.0):** New features, backward compatible
- **Major (x.0.0):** Breaking API changes

### Testing Checklist
- [ ] Upload single file (< 20MB)
- [ ] Upload large file (> 100MB)
- [ ] Batch upload 10+ files
- [ ] Chat with file references
- [ ] Conversation continuity (multi-turn)
- [ ] File deletion and cleanup
- [ ] Error handling (invalid API key, network failure)

---

## References

- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [Google Gemini API Documentation](https://ai.google.dev/docs)
- [Google GenAI SDK (Node.js)](https://github.com/googleapis/python-genai)
- [Gemini File API Guide](https://ai.google.dev/api/files)

---

**Last Updated:** 2025-11-26
**Primary Implementation:** src/index.ts
**Compiled Output:** build/index.js
**Package Version:** 0.4.0

## Recent Improvements

### v0.4.0 - Gemini 3 Support (Current)

**Major Upgrade:** Full support for Google's newest Gemini 3 model family with Gemini 3 Pro as the default model.

**New Models Added:**
- `gemini-3-pro-preview` - Most intelligent model with state-of-the-art reasoning, multimodal understanding, and agentic capabilities (DEFAULT)
- `gemini-3-pro-image-preview` - Advanced image generation with thinking support (DEFAULT for image generation)

**Existing Models Updated:**
- `gemini-2.5-pro` → Now aliased as `MODELS.PRO_25`
- `gemini-2.5-flash` → Unchanged (`MODELS.FLASH_25`)
- `gemini-2.5-flash-image` → Now aliased as `MODELS.IMAGE_GEN_25`
- `gemini-2.0-flash-exp` → Unchanged (`MODELS.FLASH_20`)

**Changes:**
1. **MODELS Constant Restructured** (src/index.ts:31-43):
   ```typescript
   const MODELS = {
     // Gemini 3 models (newest - default)
     PRO_3: "gemini-3-pro-preview",
     IMAGE_GEN_3: "gemini-3-pro-image-preview",
     // Gemini 2.5 models
     PRO_25: "gemini-2.5-pro",
     FLASH_25: "gemini-2.5-flash",
     IMAGE_GEN_25: "gemini-2.5-flash-image",
     // Gemini 2.0 models
     FLASH_20: "gemini-2.0-flash-exp",
     // Utility models
     EMBEDDING: "gemini-embedding-001",
   } as const;
   ```

2. **Chat Tool Updates:**
   - Default model changed from `gemini-2.5-pro` to `gemini-3-pro-preview`
   - Model enum expanded to include all 4 text models
   - Backward compatible: existing model selections still work

3. **Image Generation Updates:**
   - New `model` parameter added to `generate_images` tool
   - Default changed from `gemini-2.5-flash-image` to `gemini-3-pro-image-preview`
   - Users can explicitly select `gemini-2.5-flash-image` for faster generation

4. **Batch API Updates:**
   - `batch_create` and `batch_process` now support all 4 text models
   - Default remains `gemini-2.5-flash` for cost efficiency

**Token Limits by Model:**
| Model | Input Tokens | Output Tokens |
|-------|-------------|---------------|
| gemini-3-pro-preview | 1,048,576 | 65,536 |
| gemini-3-pro-image-preview | 65,536 | 32,768 |
| gemini-2.5-pro | 1,048,576 | 65,536 |
| gemini-2.5-flash | 1,048,576 | 65,536 |
| gemini-2.5-flash-image | 65,536 | 32,768 |
| gemini-2.0-flash-exp | 1,048,576 | 8,192 |

**Upgrade Notes:**
- No breaking changes - all existing code continues to work
- Users get Gemini 3 automatically without code changes
- To explicitly use older models, specify the `model` parameter

---

### v0.3.0 - Image Generation Support

**Added:** Comprehensive image generation tool using Gemini 2.5 Flash Image model

**New Features:**
1. **Text-to-Image Generation**
   - Generate images from text descriptions
   - Configurable aspect ratios (10 options: 1:1, 16:9, 9:16, etc.)
   - Batch generation (1-4 images per request)

2. **Image Editing**
   - Edit existing images with natural language instructions
   - Uses uploaded files as input via `inputImageUri` parameter

3. **File-Based Output System**
   - Auto-save to disk (default: `./generated-images/`)
   - File paths returned in response (base64 excluded to avoid token limits)

4. **Type Safety**
   - New TypeScript interfaces: `ImageGenerationArgs`, `GeneratedImage`, `ImageGenerationResponse`
   - Full validation for aspect ratios, numImages, and prompts

**Implementation Details:**
- **Tool Handler:** `handleGenerateImages()` at src/index.ts:2906-3066
- **Helper Function:** `getMimeTypeExtension()` at src/index.ts:3068-3077
- **Model Constant:** Added `IMAGE_GEN: "gemini-2.5-flash-image"` to MODELS
- **API Integration:** Uses `models.generateContent()` with `responseModalities: ["Image"]`
- **Cost:** Fixed 1,290 tokens per image (regardless of size up to 1024×1024)

**Code References:**
- Type definitions: src/types/gemini.ts:159-185
- Tool registration: src/index.ts:722-763
- Handler routing: src/index.ts:814-815

**Documentation Updates:**
- README.md: Added tool documentation with examples
- CLAUDE.md: Added implementation details and code references

**Performance Note:** The Gemini API generates one image per request. When `numImages > 1`, the handler makes sequential API calls (src/index.ts:2985-3036) to generate multiple images, resulting in ~10-15 seconds per image.

### v0.3.4 - Base64 Output Elimination Fix

**Problem:** Image generation responses could include massive base64 data (~1.9M tokens per image), causing MCP response size errors.

**Root Causes:**
1. `GeneratedImage` interface had optional `base64Data?: string` field (src/types/gemini.ts:169)
2. Potential object reference leaks from Gemini API result objects

**Solutions:**
1. **Type Safety Enhancement:** Removed `base64Data` field entirely from `GeneratedImage` interface
   - TypeScript now enforces that base64 cannot be included in response
   - Added explicit comment explaining removal to prevent future additions

2. **Explicit Primitive Extraction:** Modified `handleGenerateImages()` to explicitly convert to primitive strings
   - Uses `String()` coercion to extract values without object references
   - Prevents accidental serialization of API result objects
   - Changes at src/index.ts:3007-3031

**Code Changes:**
```typescript
// Before (risky - could capture object references)
const mimeType = part.inlineData.mimeType || "image/png";
images.push({ mimeType, filePath, aspectRatio, index });

// After (safe - explicit primitives only)
const mimeTypeStr = String(part.inlineData.mimeType || "image/png");
images.push({
  mimeType: mimeTypeStr,
  filePath: filePath,
  aspectRatio: String(aspectRatio),
  index: images.length
});
```

**Benefits:**
- Response size reduced from ~1.9M tokens to <1K tokens per image
- MCP clients can now successfully receive image generation responses
- Images still saved to disk with full base64 data for user access
- Type safety prevents future regression

**Testing:**
```bash
# Verify no base64 in response
npm run build
# Test with generate_images tool - response should be <1K tokens
```

### v0.3.3 - NPX Installation Fix (Current)

**Problem:** NPX installation was failing with "command not found" error.

**Root Cause:** Scoped packages (`@scope/name`) with multiple bin entries (object form) break npx execution.

**Solution:**
- Changed `package.json` bin from object to single string entry
- Deleted entire `scripts/` directory to simplify package
- Users now set API key via environment variable or `--env` flag
- Updated all documentation with working `@latest` suffix for npx

**Changes:**
```json
// Before (v0.3.1)
"bin": {
  "gemini-mcp": "build/index.js",
  "gemini-mcp-configure": "scripts/configure.js"
}

// After (v0.3.3)
"bin": "build/index.js"
```

**Deleted Files:**
- `scripts/configure.js` - Interactive configuration wizard (no longer needed)
- `scripts/utils.js` - Configuration helper functions
- `scripts/validate-key.js` - API key validation
- `scripts/postbuild.js` - Permission setting script

**Build Script Update:**
```json
// Inline chmod instead of postbuild script
"build": "tsc && chmod +x build/index.js"
```

**Working Installation Command:**
```bash
claude mcp add gemini -s user --env GEMINI_API_KEY=YOUR_KEY -- npx -y @mintmcqueen/gemini-mcp@latest
```

**Key Points:**
- NPX requires `@latest` suffix for scoped packages
- Single bin entry required for npx compatibility
- Simplified package: 146KB unpacked (down from 166KB)

### v0.2.4 - Package Optimization

**Changes:**
- Excluded CLAUDE.md from npm package (internal documentation)
- Reduced package size from 102.5 kB to 81.3 kB unpacked
- Fixed repository URL format in package.json

**File Changes:**
- Updated package.json `files` array to exclude CLAUDE.md
- Added CLAUDE.md to .npmignore as backup
- Fixed git repository URL format
