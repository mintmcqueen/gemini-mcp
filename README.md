# Gemini MCP Server

An MCP Server that provides access to Google's Gemini models with **file uploads** and **Batch API integration**.

## ✨ Features

- **Multiple Gemini Models on Request**: Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash, and Embedding-001 upon
- **🆕 Batch API Integration (v0.3.0)**: Async processing at 50% cost with ~24hr turnaround
  - 11 batch tools for content generation and embeddings
  - Intelligent JSONL conversion (CSV, JSON, TXT, MD)
  - Complete workflow automation
  - 8 embedding task types with AI recommendations
- **Advanced File Handling**: Upload and process 40+ files with batch support
- **Automatic Configuration**: Interactive API key setup for Claude Code & Claude Desktop
- **Conversation Management**: Multi-turn conversations with history tracking
- **Type Safety**: Full TypeScript implementation with proper type definitions
- **Production Ready**: Retry logic, error handling, and file state monitoring

## 🚀 Quick Start

### Option 1: Global Install (Recommended for Claude Code)

```bash
# Install globally
npm install -g @mintmcqueen/gemini-mcp

# Add to Claude Code
claude mcp add --transport stdio gemini --scope user --env GEMINI_API_KEY=YOUR_KEY_HERE -- gemini-mcp
```

### Option 2: Local Project Install

```bash
# Install in your project
npm install @mintmcqueen/gemini-mcp

# Add to Claude Code (adjust path as needed)
claude mcp add --transport stdio gemini --scope project --env GEMINI_API_KEY=YOUR_KEY_HERE -- node node_modules/@mintmcqueen/gemini-mcp/build/index.js
```

After any installation method, restart Claude Code and you're ready to use Gemini.

## 🔑 API Key Setup

### Get Your API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create a new API key (free)
3. Copy your key (starts with "AIza...")

### Configure Anytime

```bash
npm run configure
```

The configuration wizard will:
- Validate your API key format
- Test the key with a real Gemini API request
- Write configuration to your chosen location(s)
- Provide next steps

## 📦 What Gets Configured

### Claude Code (Global Install)
- **File:** `~/.claude.json` (user scope)
- **Format:** stdio MCP server with environment variables
```json
{
  "mcpServers": {
    "gemini": {
      "type": "stdio",
      "command": "gemini-mcp",
      "env": {
        "GEMINI_API_KEY": "your-key-here"
      }
    }
  }
}
```

### Claude Code (Local Install)
- **File:** `.mcp.json` (project scope)
- **Format:** stdio MCP server with node execution
```json
{
  "mcpServers": {
    "gemini": {
      "type": "stdio",
      "command": "node",
      "args": ["node_modules/@mintmcqueen/gemini-mcp/build/index.js"],
      "env": {
        "GEMINI_API_KEY": "your-key-here"
      }
    }
  }
}
```

### Claude Desktop
- **File:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
- **Format:** Standard MCP server configuration

### Shell Environment
- **File:** `~/.zshrc` or `~/.bashrc`
- **Format:** `export GEMINI_API_KEY="your-key-here"`

## Usage

### MCP Tools

The server provides the following tools:

#### `chat`
Send a message to Gemini with optional file attachments.

Parameters:
- `message` (required): The message to send
- `model` (optional): Model to use (gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite)
- `files` (optional): Array of files with base64 encoded data
- `temperature` (optional): Controls randomness (0.0-2.0)
- `maxTokens` (optional): Maximum response tokens
- `conversationId` (optional): Continue an existing conversation

#### `start_conversation`
Start a new conversation session.

Parameters:
- `id` (optional): Custom conversation ID

#### `clear_conversation`
Clear a conversation session.

Parameters:
- `id` (required): Conversation ID to clear

### 🆕 Batch API Tools (v0.3.0)

Process large-scale tasks asynchronously at **50% cost** with ~24 hour turnaround.

#### Content Generation

**Simple (Automated):**
```javascript
// One-call solution: Ingest → Upload → Create → Poll → Download
batch_process({
  inputFile: "prompts.csv",  // CSV, JSON, TXT, or MD
  model: "gemini-2.5-flash"
})
// Returns: Complete results with metadata
```

**Advanced (Manual Control):**
```javascript
// 1. Convert your file to JSONL
batch_ingest_content({ inputFile: "prompts.csv" })
// Returns: { outputFile: "prompts.jsonl", requestCount: 100 }

// 2. Upload JSONL
upload_file({ filePath: "prompts.jsonl" })
// Returns: { uri: "files/abc123" }

// 3. Create batch job
batch_create({
  inputFileUri: "files/abc123",
  model: "gemini-2.5-flash"
})
// Returns: { batchName: "batches/xyz789" }

// 4. Monitor progress
batch_get_status({
  batchName: "batches/xyz789",
  autoPoll: true  // Wait until complete
})
// Returns: { state: "SUCCEEDED", stats: {...} }

// 5. Download results
batch_download_results({ batchName: "batches/xyz789" })
// Returns: { results: [...], outputFile: "results.json" }
```

#### Embeddings

**Simple (Automated):**
```javascript
// One-call solution with automatic task type prompting
batch_process_embeddings({
  inputFile: "documents.txt",
  // taskType optional - will prompt if not provided
})
// Returns: 1536-dimensional embeddings array
```

**Advanced (Manual Control):**
```javascript
// 1. Select task type (if unsure)
batch_query_task_type({
  context: "Building a search engine"
})
// Returns: { selectedTaskType: "RETRIEVAL_DOCUMENT", recommendation: {...} }

// 2. Ingest content for embeddings
batch_ingest_embeddings({ inputFile: "documents.txt" })
// Returns: { outputFile: "documents.embeddings.jsonl" }

// 3-5. Same as content generation workflow
// 6. Results contain 1536-dimensional vectors
```

**Task Types (8 options):**
- `SEMANTIC_SIMILARITY` - Compare text similarity
- `CLASSIFICATION` - Categorize content
- `CLUSTERING` - Group similar items
- `RETRIEVAL_DOCUMENT` - Build search indexes
- `RETRIEVAL_QUERY` - Search queries
- `CODE_RETRIEVAL_QUERY` - Code search
- `QUESTION_ANSWERING` - Q&A systems
- `FACT_VERIFICATION` - Fact-checking

#### Job Management

```javascript
// Cancel running job
batch_cancel({ batchName: "batches/xyz789" })

// Delete completed job
batch_delete({ batchName: "batches/xyz789" })
```

**Supported Input Formats:**
- CSV (converts rows to requests)
- JSON (wraps objects as requests)
- TXT (splits lines as requests)
- MD (markdown sections as requests)
- JSONL (ready to use)

### MCP Resources

#### `gemini://models/available`
Information about available Gemini models and their capabilities.

#### `gemini://conversations/active`
List of active conversation sessions with metadata.

## 🔧 Development

```bash
npm run build        # Build TypeScript
npm run watch        # Watch mode
npm run dev          # Build + auto-restart
npm run inspector    # Debug with MCP Inspector
npm run configure    # Reconfigure API key
```
### Connection Failures

If Claude Code fails to connect:
1. Verify your API key is correct
2. Check that the command path is correct (for local installs)
3. Restart Claude Code after configuration changes

## 🔒 Security

- API keys are never logged or echoed
- Files created with 600 permissions (user read/write only)
- Masked input during key entry
- Real API validation before storage

## 🤝 Contributing

Contributions are welcome! This package is designed to be production-ready with:
- Full TypeScript types
- Comprehensive error handling
- Automatic retry logic
- Real API validation

## 📄 License

MIT - see LICENSE file

## 🙋 Support

- **MCP Protocol**: https://modelcontextprotocol.io
- **Gemini API Docs**: https://ai.google.dev/docs