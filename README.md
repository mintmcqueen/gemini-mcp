# Gemini MCP Server

An enhanced MCP (Model Context Protocol) server that provides access to Google's Gemini 2.5 Pro models with advanced file handling, batch uploads, and automatic API key configuration.

## ✨ Features

- **Multiple Gemini Models**: Gemini 2.5 Pro, 2.5 Flash, and 2.0 Flash
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

# Configure .env
gemini-mcp-configure

# Add to Claude Code
claude mcp add --transport stdio gemini --scope user --env GEMINI_API_KEY=YOUR_KEY_HERE -- gemini-mcp
```

Replace `YOUR_KEY_HERE` with your Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

### Option 2: Local Project Install

```bash
# Install in your project
npm install @mintmcqueen/gemini-mcp

# Configure .env
gemini-mcp-configure

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

### MCP Resources

#### `gemini://models/available`
Information about available Gemini models and their capabilities.

#### `gemini://conversations/active`
List of active conversation sessions with metadata.

## 🛠️ Manual Configuration

If you prefer manual setup, see the configuration examples above. The automatic configuration handles all of this for you!

### Claude Code Scopes

- **user** (default): Available across all your projects (`~/.claude.json`)
- **project**: Shared with team via `.mcp.json` in project root
- **local**: Private to you in current project (`.claude/settings.local.json`)

The installer uses **user scope** by default for maximum convenience.

## Development

- `npm run build` - Build the project
- `npm run watch` - Build and watch for changes
- `npm run dev` - Development mode with auto-restart
- `npm run inspector` - Run with MCP Inspector for debugging

## File Upload Format

When using the `chat` tool with files, provide them in this format:

```json
{
  "message": "Analyze this image",
  "files": [
    {
      "name": "image.jpg",
      "mimeType": "image/jpeg", 
      "data": "base64-encoded-file-data"
    }
  ]
}
```

Supported file types:
- Images: JPEG, PNG, GIF, WebP
- Documents: PDF, TXT, MD
- And more based on Gemini's capabilities

## 🔧 Development

```bash
npm run build        # Build TypeScript
npm run watch        # Watch mode
npm run dev          # Build + auto-restart
npm run inspector    # Debug with MCP Inspector
npm run configure    # Reconfigure API key
```

## 📚 Documentation

- **README.md**: Quick start and usage guide
- **ENHANCEMENTS.md**: Technical details about file handling improvements

## 🔧 Troubleshooting

### npx Installation Issues

If you encounter "sh: gemini-mcp: command not found" when using npx:

**Problem**: npx has difficulty executing the bin script directly due to environment setup issues.

**Solutions**:
1. **Use global install** (recommended): `npm install -g @mintmcqueen/gemini-mcp`
2. **Use local install**: Install in project and use node directly
3. **Clear npx cache**: `rm -rf ~/.npm/_npx/*` and try again

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

- **Issues**: https://github.com/mintmcqueen/gemini-mcp/issues
- **API Key**: https://aistudio.google.com/app/apikey
- **MCP Protocol**: https://modelcontextprotocol.io
- **Gemini API Docs**: https://ai.google.dev/docs