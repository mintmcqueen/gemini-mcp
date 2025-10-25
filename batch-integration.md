# Gemini Batch API Integration Plan

## Overview
Add complete Gemini Batch API support with 11 tools total: low-level control tools, high-level convenience tools, intelligent content ingestion, and embedding-specific workflows.

**⚠️ Breaking Change:** This implementation includes renaming `batch_upload_files` → `upload_multiple_files` to eliminate naming collision with Batch API tools. The "batch" prefix is reserved exclusively for Gemini Batch API operations (async content generation at 50% cost).

---

## Tools to Implement (11 Total)

### Content Generation Batch Tools (5)

**1. `batch_create` - Create content generation batch job**
- Parameters:
  - `model` (default: "gemini-2.5-flash")
  - `requests` (inline array, optional)
  - `input_file_uri` (from upload_file, optional)
  - `display_name` (optional)
  - `output_location` (optional, default: process.cwd())
  - `config` (optional: systemInstruction, temperature, etc.)
- Prompts user for output location if not provided
- Validates either requests OR input_file_uri is provided
- Returns: Batch job object with `name`, estimated completion time

**2. `batch_process` - Complete content generation workflow**
- Parameters:
  - `input_file_path` (path to any text file or JSONL)
  - `model` (default: "gemini-2.5-flash")
  - `display_name` (optional)
  - `output_location` (optional, default: process.cwd())
  - `polling_interval_seconds` (default: 30)
  - `auto_ingest` (boolean, default: true) - use content ingestion if not JSONL
- Workflow:
  1. If NOT JSONL → call `batch_ingest_content` to convert
  2. Upload JSONL via `upload_file` → get file URI
  3. Create batch job via SDK
  4. Poll until complete (with progress updates)
  5. Download results to output_location
  6. Parse and return processed results
- Returns: Full results array + metadata

**3. `batch_ingest_content` - Intelligent content ingestion & JSONL conversion**
- Parameters:
  - `source_file_path` (any structured/unstructured text file)
  - `output_jsonl_path` (optional, default: source_name + `.jsonl`)
  - `analysis_config` (optional)
- Workflow:
  1. Analyze content structure (CSV, JSON, TXT, MD, etc.)
  2. Write analysis script if complex extraction needed
  3. Write extraction script to structure data
  4. Convert to JSONL format (each line = {key, request})
  5. Validate JSONL format
  6. Return: JSONL file path + conversion report
- Supports: CSV, JSON, XML, TXT, MD, TSV, Excel (via script generation)
- Returns: { jsonlPath, conversionReport, totalRequests, validationPassed }

**4. `batch_get_status` - Get batch job status with optional auto-polling**
- Parameters:
  - `batch_name` (job ID from batch_create)
  - `wait_for_completion` (boolean, default: false)
  - `polling_interval_seconds` (default: 30)
  - `output_location` (optional for auto-download)
- If `wait_for_completion=true`: polls until terminal state + auto-downloads results
- Returns: Batch job object with state, progress, results (if complete)

**5. `batch_download_results` - Download and parse batch results**
- Parameters:
  - `batch_name` OR `result_file_uri`
  - `output_location` (optional, default: process.cwd())
  - `parse_format` ("jsonl" | "array" | "csv", default: "array")
- Downloads result file from Gemini File API
- Parses JSONL to structured format
- Saves to output_location
- Returns: Parsed results + file path

### Embedding Batch Tools (4)

**6. `batch_create_embeddings` - Create embeddings batch job**
- Parameters:
  - `model` (default: "gemini-embedding-001")
  - `requests` (inline array, optional)
  - `input_file_uri` (from upload_file, optional)
  - `task_type` (required - see task types below)
  - `display_name` (optional)
  - `output_location` (optional, default: process.cwd())
- **Intelligent task_type handling:**
  - If not provided OR unclear → prompt user with options (see Task Type Decision Matrix)
  - If provided but seems mismatched → confirm with user
- Supports all 8 task types: SEMANTIC_SIMILARITY, CLASSIFICATION, CLUSTERING, RETRIEVAL_DOCUMENT, RETRIEVAL_QUERY, CODE_RETRIEVAL_QUERY, QUESTION_ANSWERING, FACT_VERIFICATION
- Returns: Batch job object with `name`

**7. `batch_process_embeddings` - Complete embeddings workflow**
- Parameters:
  - `input_file_path` (path to any text file or JSONL)
  - `model` (default: "gemini-embedding-001")
  - `task_type` (optional - will prompt if missing)
  - `display_name` (optional)
  - `output_location` (optional, default: process.cwd())
  - `polling_interval_seconds` (default: 30)
  - `auto_ingest` (boolean, default: true)
- Same workflow as batch_process but for embeddings
- Includes intelligent task_type clarification via user prompt
- Returns: Embeddings array + metadata

**8. `batch_ingest_embeddings` - Content ingestion for embeddings**
- Parameters:
  - `source_file_path`
  - `task_type` (optional - will prompt)
  - `output_jsonl_path` (optional)
- Specialized for embeddings: extracts text content for embedding
- Formats as embedContent requests with proper task_type
- Returns: { jsonlPath, conversionReport, totalTexts, taskType }

**9. `batch_query_task_type` - Interactive task type selector**
- Parameters:
  - `context_description` (optional - user describes their use case)
  - `sample_texts` (optional - array of example texts)
- Analyzes context/samples and recommends task_types
- Presents interactive selection UI with descriptions
- Returns: { recommendedTaskType, confidence, reasoning }

### Universal Batch Tools (2)

**10. `batch_cancel` - Cancel running batch job**
- Parameters: `batch_name`
- Calls: `genAI.batches.cancel()`
- Returns: Cancellation confirmation

**11. `batch_delete` - Delete batch job**
- Parameters: `batch_name`
- Calls: `genAI.batches.delete()`
- Returns: Deletion confirmation

---

## Task Type Decision Matrix for Embeddings

Tool will prompt user with this decision tree:

```
Q: "What will you use these embeddings for?"

Options:
1. "Find similar content" → SEMANTIC_SIMILARITY
2. "Categorize into predefined labels" → CLASSIFICATION
3. "Group by similarity (no labels)" → CLUSTERING
4. "Search documents by keyword/query" →
   - Follow-up: "Are these documents or queries?"
     - Documents → RETRIEVAL_DOCUMENT
     - Queries → RETRIEVAL_QUERY
5. "Search code by description" → CODE_RETRIEVAL_QUERY
6. "Answer questions in a chatbot" → QUESTION_ANSWERING
7. "Verify facts/statements" → FACT_VERIFICATION
```

### Task Type Reference Table

| Task Type | Purpose | Use Cases |
|-----------|---------|-----------|
| **SEMANTIC_SIMILARITY** | "Embeddings optimized to assess text similarity" | Recommendation systems, duplicate detection |
| **CLASSIFICATION** | "Embeddings optimized to classify texts according to preset labels" | Sentiment analysis, spam detection |
| **CLUSTERING** | "Embeddings optimized to cluster texts based on their similarities" | Document organization, market research, anomaly detection |
| **RETRIEVAL_DOCUMENT** | "Embeddings optimized for document search" | Indexing articles, books, or web pages |
| **RETRIEVAL_QUERY** | "Embeddings optimized for general search queries" | Custom search (pair with RETRIEVAL_DOCUMENT for documents) |
| **CODE_RETRIEVAL_QUERY** | "Embeddings optimized for retrieval of code blocks based on natural language queries" | Code suggestions and search (pair with RETRIEVAL_DOCUMENT) |
| **QUESTION_ANSWERING** | "Embeddings for questions in a question-answering system" | Chatbots (use for questions; pair with RETRIEVAL_DOCUMENT) |
| **FACT_VERIFICATION** | "Embeddings for statements that need to be verified" | Automated fact-checking (use for statements; pair with RETRIEVAL_DOCUMENT) |

---

## Implementation Structure

### 1. New Type Definitions (`src/types/gemini.ts`)

Add ~150 lines:

```typescript
// Batch API types
export interface BatchJob {
  name: string;
  displayName?: string;
  state: BatchJobState;
  createTime?: string;
  updateTime?: string;
  completionTime?: string;
  dest?: {
    fileName?: string;
    inlinedResponses?: any[];
    inlinedEmbedContentResponses?: any[];
  };
  inputConfig?: {
    fileName?: string;
    requests?: { requests: any[] };
  };
  batchStats?: {
    successfulRequestCount?: number;
    failedRequestCount?: number;
    totalRequestCount?: number;
  };
  error?: any;
}

export enum BatchJobState {
  JOB_STATE_PENDING = "JOB_STATE_PENDING",
  JOB_STATE_RUNNING = "JOB_STATE_RUNNING",
  JOB_STATE_SUCCEEDED = "JOB_STATE_SUCCEEDED",
  JOB_STATE_FAILED = "JOB_STATE_FAILED",
  JOB_STATE_CANCELLED = "JOB_STATE_CANCELLED",
  JOB_STATE_EXPIRED = "JOB_STATE_EXPIRED",
}

export enum EmbeddingTaskType {
  SEMANTIC_SIMILARITY = "SEMANTIC_SIMILARITY",
  CLASSIFICATION = "CLASSIFICATION",
  CLUSTERING = "CLUSTERING",
  RETRIEVAL_DOCUMENT = "RETRIEVAL_DOCUMENT",
  RETRIEVAL_QUERY = "RETRIEVAL_QUERY",
  CODE_RETRIEVAL_QUERY = "CODE_RETRIEVAL_QUERY",
  QUESTION_ANSWERING = "QUESTION_ANSWERING",
  FACT_VERIFICATION = "FACT_VERIFICATION",
}

export interface ContentIngestionReport {
  sourceFile: string;
  outputFile: string;
  sourceFormat: string;
  totalRequests: number;
  validationPassed: boolean;
  errors: string[];
  analysisScripts?: string[];
  extractionScripts?: string[];
}

export interface BatchCreateParams {
  model: string;
  requests?: any[];
  inputFileUri?: string;
  displayName?: string;
  outputLocation?: string;
  config?: {
    systemInstruction?: any;
    temperature?: number;
    maxOutputTokens?: number;
    [key: string]: any;
  };
}

export interface BatchEmbeddingParams {
  model: string;
  requests?: any[];
  inputFileUri?: string;
  taskType: EmbeddingTaskType;
  displayName?: string;
  outputLocation?: string;
}
```

### 2. Helper Functions (`src/index.ts`, after line 527)

Add ~400 lines:

```typescript
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

    if (completedStates.has(batchJob.state)) {
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

    const filePath = path.join(outputLocation, `batch_results_${Date.now()}.json`);
    const fs = await import("fs/promises");
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

    const filePath = path.join(outputLocation, `batch_results_${Date.now()}.jsonl`);
    const fs = await import("fs/promises");
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
```

### 3. Tool Handlers (`src/index.ts`, ~lines 1200-2500)

Add 11 tool handlers following existing patterns. Each handler should:
- Validate input parameters
- Use `getGenAI()` for lazy initialization
- Include comprehensive error handling
- Log progress to stderr
- Return structured JSON responses

Tool handler structure example:

```typescript
private async handleBatchCreate(args: any) {
  const model = args?.model || "gemini-2.5-flash";
  const requests = args?.requests;
  const inputFileUri = args?.input_file_uri;
  const displayName = args?.display_name;
  const outputLocation = args?.output_location || process.cwd();
  const config = args?.config || {};

  // Validate inputs
  if (!requests && !inputFileUri) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Either 'requests' or 'input_file_uri' must be provided"
    );
  }

  try {
    const genAI = await this.getGenAI();

    // Create batch job
    let batchJob;
    if (requests) {
      // Inline requests
      batchJob = await genAI.batches.create({
        model,
        src: requests,
        config: { displayName, ...config }
      });
    } else {
      // File-based requests
      batchJob = await genAI.batches.create({
        model,
        src: inputFileUri,
        config: { displayName, ...config }
      });
    }

    console.error(`[Batch] Created batch job: ${batchJob.name}`);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Batch job created successfully",
          batchName: batchJob.name,
          state: batchJob.state,
          displayName: batchJob.displayName,
          outputLocation,
          estimatedCompletionTime: "Within 24 hours (often much faster)"
        }, null, 2)
      }]
    };
  } catch (error: any) {
    console.error("[Batch] Error creating batch job:", error);
    return {
      content: [{
        type: "text",
        text: `Error creating batch job: ${error.message}`
      }],
      isError: true
    };
  }
}
```

### 4. Tool Schema Definitions (`src/index.ts`, in setupToolHandlers)

Add 11 tool definitions to the tools array. Example:

```typescript
{
  name: "batch_create",
  description: "CREATE BATCH CONTENT GENERATION JOB - Submit batch of prompts for async processing at 50% cost. WORKFLOW: Accepts inline requests array OR file URI from upload_file. Returns batch job ID for status tracking. TARGET TURNAROUND: 24 hours (often faster). COST: 50% of standard API pricing. USE CASE: Large-scale non-urgent tasks like data preprocessing, evaluations, bulk content generation.",
  inputSchema: {
    type: "object",
    properties: {
      model: {
        type: "string",
        enum: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash-exp"],
        default: "gemini-2.5-flash",
        description: "The Gemini model to use"
      },
      requests: {
        type: "array",
        description: "Inline array of GenerateContentRequest objects (for small batches <20MB)"
      },
      input_file_uri: {
        type: "string",
        description: "File URI from upload_file containing JSONL batch requests (for large batches)"
      },
      display_name: {
        type: "string",
        description: "Optional display name for the batch job"
      },
      output_location: {
        type: "string",
        description: "Directory path for saving results (default: current directory)"
      },
      config: {
        type: "object",
        description: "Optional configuration (systemInstruction, temperature, etc.)"
      }
    }
  }
}
```

### 5. Resource Handler Addition (`src/index.ts`, line 146)

Add new resource to the list:

```typescript
{
  uri: "gemini://batches/active",
  name: "Active Batch Jobs",
  mimeType: "application/json",
  description: "List of active batch jobs with status and stats"
}
```

And add handler in ReadResourceRequestSchema:

```typescript
if (uri === "gemini://batches/active") {
  // Implement batch listing logic
  // Note: May need to track batch jobs in server state
  const batchesData = {
    batches: [], // Implement batch tracking
    message: "Batch job tracking to be implemented"
  };

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "application/json",
      text: JSON.stringify(batchesData, null, 2)
    }]
  };
}
```

---

## File Modifications Summary

### 1. `src/index.ts` (~800 new lines)
- **Line 28**: Add embedding model to MODELS constant
- **Line 527**: Add 9 helper functions (~400 lines)
- **Line 246**: Add 11 tool definitions to tools array (~200 lines)
- **Line 420**: Add 11 tool handler cases to switch statement
- **Line 1200**: Add 11 tool handler implementations (~400 lines)
- **Line 146**: Add batch resource definition
- **Line 210**: Add batch resource handler

### 2. `src/types/gemini.ts` (~150 new lines)
- Add BatchJob interface
- Add BatchJobState enum
- Add EmbeddingTaskType enum
- Add ContentIngestionReport interface
- Add BatchCreateParams interface
- Add BatchEmbeddingParams interface

### 3. `CLAUDE.md` (~400 new lines)
- **New Section (Line ~1250)**: "Batch API Integration"
  - Overview of batch processing capabilities
  - Cost savings analysis (50% vs standard API)
- **Subsection**: Content Generation Tools
  - batch_create examples
  - batch_process workflow
  - batch_ingest_content usage
- **Subsection**: Embeddings Tools
  - Task type decision tree
  - batch_create_embeddings examples
  - batch_process_embeddings workflow
- **Subsection**: Common Workflows
  - CSV → batch processing
  - Large-scale embeddings
  - Error handling strategies
- **Subsection**: Technical Details
  - API limits and quotas
  - Best practices
  - Performance expectations
- Update component flow diagram
- Add code references for all new functions

### 4. `README.md` (~100 new lines)
- **Features Section**: Add batch processing capabilities
- **Quick Start**: Add batch example
- **Embeddings Section**: Add task type guide
- **Use Cases**: Add batch processing scenarios

### 5. `package.json` (version bump)
```json
{
  "version": "0.3.0",
  "description": "MCP server for Google Gemini with multimodal, batch processing, and embeddings support"
}
```

---

## Expected User Experience

### Example 1: Simple Batch Content Generation from CSV
```javascript
// User has a CSV file with prompts
await batch_process({
  input_file_path: "prompts.csv",
  output_location: "./results"
});

// Tool automatically:
// 1. Detects CSV format
// 2. Converts to JSONL
// 3. Uploads JSONL file
// 4. Creates batch job
// 5. Polls until complete
// 6. Downloads results to ./results/batch_results_[timestamp].json

// Results: {
//   results: [...],
//   filePath: "./results/batch_results_1234567890.json",
//   stats: { successful: 100, failed: 0 }
// }
```

### Example 2: Embeddings with Task Type Guidance
```javascript
await batch_process_embeddings({
  input_file_path: "documents.txt",
  output_location: "./embeddings"
});

// Console output:
// [Batch Embeddings] Task Type Selection Required
// Available task types:
//   1. SEMANTIC_SIMILARITY - Find similar content
//   2. CLASSIFICATION - Categorize into predefined labels
//   3. CLUSTERING - Group by similarity (no labels)
//   4. RETRIEVAL_DOCUMENT - Index documents for search
//   ...
//
// [Batch] Using task type: RETRIEVAL_DOCUMENT (default)
// [Batch] Converting documents.txt to JSONL...
// [Batch] Uploading JSONL file...
// [Batch] Creating embeddings batch job...
// [Batch] Polling status... (state: JOB_STATE_RUNNING)
// [Batch] Job completed successfully
// [Batch] Downloading results...
// [Batch] Results saved to: ./embeddings/batch_results_1234567890.json
```

### Example 3: Low-Level Control
```javascript
// Manual workflow with full control

// Step 1: Ingest content to JSONL
const ingestion = await batch_ingest_content({
  source_file_path: "data.json",
  output_jsonl_path: "batch_requests.jsonl"
});
// Returns: { jsonlPath, totalRequests: 100, validationPassed: true }

// Step 2: Upload JSONL
const upload = await upload_file({
  filePath: ingestion.jsonlPath
});
// Returns: { fileUri: "files/abc123..." }

// Step 3: Create batch job
const batch = await batch_create({
  input_file_uri: upload.fileUri,
  model: "gemini-2.5-flash",
  display_name: "My Batch Job"
});
// Returns: { batchName: "batches/xyz789..." }

// Step 4: Poll manually
let status;
while (true) {
  status = await batch_get_status({ batch_name: batch.batchName });
  if (status.state === "JOB_STATE_SUCCEEDED") break;
  await sleep(30000);
}

// Step 5: Download results
const results = await batch_download_results({
  batch_name: batch.batchName,
  output_location: "./output"
});
// Returns: { results: [...], filePath: "./output/batch_results.json" }
```

### Example 4: Task Type Recommendation
```javascript
await batch_query_task_type({
  context_description: "I want to build a recommendation system that suggests similar articles to users",
  sample_texts: [
    "How to train a neural network",
    "Deep learning fundamentals",
    "Machine learning basics"
  ]
});

// Returns: {
//   recommendedTaskType: "SEMANTIC_SIMILARITY",
//   confidence: 0.95,
//   reasoning: "Context mentions finding similar content and recommendation system - SEMANTIC_SIMILARITY is optimal for this use case"
// }
```

---

## Cost Analysis

### Pricing Comparison

| Operation | Standard API | Batch API | Savings |
|-----------|-------------|-----------|---------|
| 1,000 prompts | $X | $X/2 | 50% |
| 10,000 embeddings | $Y | $Y/2 | 50% |
| 100,000 requests | $Z | $Z/2 | 50% |

### Break-Even Analysis

- **Small batches (<100 requests)**: Standard API may be faster
- **Medium batches (100-1,000)**: Batch API starts to show value
- **Large batches (>1,000)**: Batch API is clearly superior (50% cost savings + no rate limiting concerns)

### When to Use Batch API

✅ **Use Batch API when:**
- Processing >100 requests
- No urgency (can wait 1-24 hours)
- Cost optimization is priority
- Running evaluations/benchmarks
- Bulk data preprocessing

❌ **Use Standard API when:**
- Need immediate results
- Interactive user-facing application
- <100 requests
- Real-time responses required

---

## Testing Strategy

### Test Files to Create

**1. `test-batch-inline.mjs`** - Test inline content generation
```javascript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const inlinedRequests = [
  { contents: [{ parts: [{ text: 'Tell me a one-sentence joke.' }] }] },
  { contents: [{ parts: [{ text: 'Why is the sky blue?' }] }] },
  { contents: [{ parts: [{ text: 'What is the capital of France?' }] }] }
];

const batch = await ai.batches.create({
  model: 'gemini-2.5-flash',
  src: inlinedRequests,
  config: { displayName: 'Test Inline Batch' }
});

console.log('Created batch:', batch.name);
```

**2. `test-batch-file.mjs`** - Test file-based workflow
```javascript
// Test complete file-based batch workflow
// 1. Create sample JSONL
// 2. Upload via MCP
// 3. Create batch job
// 4. Poll status
// 5. Download results
```

**3. `test-batch-ingest.mjs`** - Test content ingestion
```javascript
// Test CSV → JSONL conversion
// Test JSON → JSONL conversion
// Test TXT → JSONL conversion
// Validate output format
```

**4. `test-batch-embeddings.mjs`** - Test embeddings with task type
```javascript
// Test embeddings batch creation
// Test task_type parameter
// Validate results format
```

**5. `test-batch-high-level.mjs`** - Test batch_process end-to-end
```javascript
// Test complete workflow: CSV → results
// Test error handling
// Test output location
```

### Manual Test Scenarios

1. **Happy Path**: CSV → batch_process → results
2. **Invalid Format**: Pass unsupported file format
3. **Missing Task Type**: Embeddings without task_type
4. **Invalid Output Location**: Non-existent directory
5. **Batch Cancellation**: Create batch, then cancel
6. **Batch Expiration**: Wait 48+ hours (if feasible)
7. **Large File**: Test with >1,000 requests
8. **Failed Requests**: Some requests trigger errors

---

## Documentation Updates

### CLAUDE.md Structure

Add new section starting around line 1250:

```markdown
## Batch API Integration

### Overview
The Gemini MCP server provides comprehensive batch processing capabilities for both content generation and embeddings, offering 50% cost savings compared to the standard API.

### Architecture
[Component flow diagram showing batch workflow]

### Tools

#### Content Generation Tools
- batch_create
- batch_process
- batch_ingest_content
- batch_get_status
- batch_download_results

#### Embeddings Tools
- batch_create_embeddings
- batch_process_embeddings
- batch_ingest_embeddings
- batch_query_task_type

#### Universal Tools
- batch_cancel
- batch_delete

### Workflows

#### Simple Batch Processing
[Step-by-step guide with code examples]

#### Advanced Embeddings
[Task type selection guide with examples]

### Cost Analysis
[Pricing comparison table]

### Best Practices
[Tips for optimal batch usage]

### Code References
[Line numbers for all new functions]
```

### README.md Updates

Update features section:

```markdown
## Features

- **Multimodal Chat**: Send text, images, video, audio, documents to Gemini
- **Batch Processing**: Process large volumes at 50% cost
  - Content generation batches
  - Embeddings with 8 task types
  - Intelligent content ingestion (CSV, JSON, TXT → JSONL)
- **File Management**: Upload, list, retrieve, delete files
- **Conversation Management**: Multi-turn conversations with history
```

Add batch examples:

```markdown
## Batch Processing Examples

### Content Generation from CSV
\`\`\`javascript
await batch_process({
  input_file_path: "prompts.csv",
  output_location: "./results"
});
\`\`\`

### Embeddings with Task Types
\`\`\`javascript
await batch_process_embeddings({
  input_file_path: "documents.txt",
  task_type: "RETRIEVAL_DOCUMENT",
  output_location: "./embeddings"
});
\`\`\`
```

---

## Implementation Timeline

### Phase 0: Rename Existing Tool (Day 1, ~2 hours)

**Purpose:** Eliminate naming collision by renaming `batch_upload_files` → `upload_multiple_files` to reserve "batch" prefix exclusively for Batch API tools.

**Changes Required:**

#### src/index.ts (9 changes)
- [ ] **Line 39**: Rename interface `BatchUploadResult` → `MultipleUploadResult`
- [ ] **Line 249**: Update chat tool description reference: `batch_upload_files` → `upload_multiple_files`
- [ ] **Line 291**: Rename tool: `"batch_upload_files"` → `"upload_multiple_files"`
- [ ] **Line 292**: Update tool description to reflect new name
- [ ] **Line 346**: Update upload_file description reference: `batch_upload_files` → `upload_multiple_files`
- [ ] **Line 428**: Update switch case: `case "batch_upload_files":` → `case "upload_multiple_files":`
- [ ] **Line 429**: Update handler call: `handleBatchUpload(args)` → `handleMultipleUpload(args)`
- [ ] **Line 529**: Rename function: `handleBatchUpload` → `handleMultipleUpload`
- [ ] **Line 543**: Update variable type: `BatchUploadResult` → `MultipleUploadResult`

#### CLAUDE.md (3 changes)
- [ ] **Line 31**: Update tool handlers list reference
- [ ] **Line 67**: Update tool description with new name and code reference
- [ ] **Line 478**: Update Known Issues section reference

#### Testing
- [ ] Test `upload_multiple_files` works correctly after rename
- [ ] Verify no breaking changes to functionality
- [ ] Update any internal test scripts if they reference old name

**Breaking Change Note:** This is a breaking change for users of v0.2.x who call `batch_upload_files` directly. Document in release notes.

---

### Phase 1: Foundation (Days 1-2)
- [ ] Add type definitions
- [ ] Add helper functions
- [ ] Add tool schemas
- [ ] Test basic batch creation

### Phase 2: Content Tools (Day 3)
- [ ] Implement batch_create
- [ ] Implement batch_get_status
- [ ] Implement batch_download_results
- [ ] Test file-based workflow

### Phase 3: Ingestion (Day 4)
- [ ] Implement batch_ingest_content
- [ ] Test CSV conversion
- [ ] Test JSON conversion
- [ ] Implement batch_process

### Phase 4: Embeddings (Day 5)
- [ ] Implement batch_create_embeddings
- [ ] Implement task type selection
- [ ] Implement batch_process_embeddings
- [ ] Implement batch_query_task_type

### Phase 5: Testing & Documentation (Days 6-7)
- [ ] Create all test files
- [ ] Run comprehensive tests
- [ ] Update CLAUDE.md
- [ ] Update README.md
- [ ] Version bump to 0.3.0

---

## Success Criteria

✅ All 11 tools implemented and working
✅ Content ingestion handles CSV, JSON, TXT, JSONL
✅ Embeddings tool guides users to correct task_type
✅ Output location is configurable
✅ Both inline and file-based batches work
✅ Polling and auto-download work correctly
✅ Error handling is comprehensive
✅ Documentation is complete with examples
✅ All tests pass
✅ 50% cost savings vs standard API confirmed

---

## Known Limitations & Future Enhancements

### Current Limitations
- Task type selection is console-based (not fully interactive)
- No persistent batch job tracking across server restarts
- Output location prompting uses default (no interactive prompt)

### Future Enhancements
- Add interactive CLI prompts for task type selection
- Persist batch job state to disk
- Add batch job list/history resource
- Add retry logic for failed batch requests
- Add batch job scheduling
- Add cost estimation before batch creation
- Add progress notifications via webhooks

---

## Version History

- **v0.2.10**: Current version (file upload, chat, conversations)
- **v0.3.0**: Batch API integration (this plan)
  - **BREAKING CHANGE**: `batch_upload_files` renamed to `upload_multiple_files`
  - Added 11 new Batch API tools (batch_create, batch_process, etc.)
  - Added content ingestion system (CSV/JSON/TXT → JSONL)
  - Added embeddings batch support with 8 task types
  - Added intelligent task type selection for embeddings
  - Cost savings: 50% vs standard API for batch operations
- **v0.4.0**: Planned - Advanced batch features (scheduling, webhooks, etc.)
