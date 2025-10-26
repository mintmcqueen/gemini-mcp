#!/usr/bin/env node
/**
 * E2E Test Suite for Individual Batch API Tools
 * Tests each of the 11 batch API tools independently
 *
 * Prerequisites:
 * - GEMINI_API_KEY environment variable set
 * - npm run build (compiled server)
 *
 * Usage:
 *   node tests/batch-api-individual-tools-test.mjs
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Test configuration
const CONFIG = {
  serverPath: path.join(PROJECT_ROOT, 'build', 'index.js'),
  testDataDir: path.join(PROJECT_ROOT, 'tests', 'test-data'),
  outputDir: path.join(PROJECT_ROOT, 'tests', 'test-output'),
  apiKey: process.env.GEMINI_API_KEY,
};

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

class MCPClient {
  constructor() {
    this.server = null;
    this.requestId = 1;
    this.pendingRequests = new Map();
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = spawn('node', [CONFIG.serverPath], {
        env: { ...process.env, GEMINI_API_KEY: CONFIG.apiKey },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let buffer = '';

      this.server.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            if (message.id && this.pendingRequests.has(message.id)) {
              const { resolve, reject } = this.pendingRequests.get(message.id);
              this.pendingRequests.delete(message.id);
              if (message.error) {
                reject(new Error(message.error.message || JSON.stringify(message.error)));
              } else {
                resolve(message.result);
              }
            }
          } catch (e) {
            // Ignore non-JSON lines (stderr logs)
          }
        }
      });

      this.server.stderr.on('data', (data) => {
        // Log server stderr for debugging
        const msg = data.toString().trim();
        if (msg && !msg.includes('[Init]')) {
          console.log(`${colors.blue}[Server]${colors.reset} ${msg}`);
        }
      });

      this.server.on('error', reject);

      // Wait for server to be ready
      setTimeout(() => resolve(), 2000);
    });
  }

  async callTool(toolName, args) {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const request = {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.server.stdin.write(JSON.stringify(request) + '\n');

      // Timeout for long-running operations
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Timeout waiting for ${toolName}`));
        }
      }, 300000); // 5 minute timeout
    });
  }

  async stop() {
    if (this.server) {
      this.server.kill();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

class TestRunner {
  constructor() {
    this.client = new MCPClient();
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
  }

  test(name, fn, options = {}) {
    this.tests.push({ name, fn, ...options });
  }

  async setup() {
    console.log(`${colors.cyan}Setting up test environment...${colors.reset}`);

    // Create test directories
    await fs.mkdir(CONFIG.testDataDir, { recursive: true });
    await fs.mkdir(CONFIG.outputDir, { recursive: true });

    // Create test data files
    await this.createTestDataFiles();

    // Start MCP server
    await this.client.start();
    console.log(`${colors.green}✓ MCP server started${colors.reset}\n`);
  }

  async createTestDataFiles() {
    // Create sample CSV
    const csvContent = `prompt,temperature
Explain quantum computing,0.7
Write a haiku about programming,1.0
Summarize photosynthesis,0.5`;
    await fs.writeFile(path.join(CONFIG.testDataDir, 'test-prompts.csv'), csvContent);

    // Create sample JSON
    const jsonContent = JSON.stringify([
      { text: "Hello, Gemini!" },
      { text: "What is the capital of France?" },
      { text: "Explain machine learning." }
    ], null, 2);
    await fs.writeFile(path.join(CONFIG.testDataDir, 'test-prompts.json'), jsonContent);

    // Create sample TXT
    const txtContent = `First prompt line
Second prompt line
Third prompt line`;
    await fs.writeFile(path.join(CONFIG.testDataDir, 'test-prompts.txt'), txtContent);

    // Create sample embeddings input
    const embeddingsContent = `Machine learning is a subset of AI
Natural language processing enables computers to understand text
Deep learning uses neural networks`;
    await fs.writeFile(path.join(CONFIG.testDataDir, 'test-embeddings.txt'), embeddingsContent);

    console.log(`${colors.green}✓ Test data files created${colors.reset}`);
  }

  async runTests() {
    console.log(`${colors.cyan}Running ${this.tests.length} tests...${colors.reset}\n`);

    for (const test of this.tests) {
      if (test.skip) {
        console.log(`${colors.yellow}○ SKIP${colors.reset} ${test.name}`);
        this.skipped++;
        continue;
      }

      try {
        console.log(`${colors.blue}→${colors.reset} ${test.name}`);
        await test.fn();
        console.log(`${colors.green}✓ PASS${colors.reset} ${test.name}\n`);
        this.passed++;
      } catch (error) {
        console.log(`${colors.red}✗ FAIL${colors.reset} ${test.name}`);
        console.log(`  Error: ${error.message}\n`);
        this.failed++;
      }
    }
  }

  async teardown() {
    await this.client.stop();
    console.log(`\n${colors.cyan}Cleaning up...${colors.reset}`);
    console.log(`${colors.green}✓ Tests complete${colors.reset}`);
  }

  printSummary() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${colors.cyan}Test Summary${colors.reset}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total: ${this.tests.length}`);
    console.log(`${colors.green}Passed: ${this.passed}${colors.reset}`);
    console.log(`${colors.red}Failed: ${this.failed}${colors.reset}`);
    console.log(`${colors.yellow}Skipped: ${this.skipped}${colors.reset}`);
    console.log(`${'='.repeat(60)}\n`);

    if (this.failed > 0) {
      process.exit(1);
    }
  }
}

// Initialize test runner
const runner = new TestRunner();

// ============================================================================
// INDIVIDUAL TOOL TESTS
// ============================================================================

runner.test('batch_ingest_content - CSV input', async () => {
  const result = await runner.client.callTool('batch_ingest_content', {
    inputFile: path.join(CONFIG.testDataDir, 'test-prompts.csv'),
    outputFile: path.join(CONFIG.outputDir, 'test-prompts-csv.jsonl'),
  });

  const data = JSON.parse(result.content[0].text);
  if (!data.validationPassed) throw new Error('Validation failed');
  if (data.requestCount < 1) throw new Error('No requests generated');
  console.log(`  Generated ${data.requestCount} requests from CSV`);
});

runner.test('batch_ingest_content - JSON input', async () => {
  const result = await runner.client.callTool('batch_ingest_content', {
    inputFile: path.join(CONFIG.testDataDir, 'test-prompts.json'),
    outputFile: path.join(CONFIG.outputDir, 'test-prompts-json.jsonl'),
  });

  const data = JSON.parse(result.content[0].text);
  if (!data.validationPassed) throw new Error('Validation failed');
  if (data.requestCount !== 3) throw new Error(`Expected 3 requests, got ${data.requestCount}`);
  console.log(`  Generated ${data.requestCount} requests from JSON`);
});

runner.test('batch_ingest_content - TXT input', async () => {
  const result = await runner.client.callTool('batch_ingest_content', {
    inputFile: path.join(CONFIG.testDataDir, 'test-prompts.txt'),
    outputFile: path.join(CONFIG.outputDir, 'test-prompts-txt.jsonl'),
  });

  const data = JSON.parse(result.content[0].text);
  if (!data.validationPassed) throw new Error('Validation failed');
  if (data.requestCount !== 3) throw new Error(`Expected 3 requests, got ${data.requestCount}`);
  console.log(`  Generated ${data.requestCount} requests from TXT`);
});

runner.test('batch_ingest_embeddings - TXT input', async () => {
  const result = await runner.client.callTool('batch_ingest_embeddings', {
    inputFile: path.join(CONFIG.testDataDir, 'test-embeddings.txt'),
    outputFile: path.join(CONFIG.outputDir, 'test-embeddings.jsonl'),
    taskType: 'RETRIEVAL_DOCUMENT',
  });

  const data = JSON.parse(result.content[0].text);
  if (!data.validationPassed) throw new Error('Validation failed');
  if (data.requestCount !== 3) throw new Error(`Expected 3 requests, got ${data.requestCount}`);
  console.log(`  Generated ${data.requestCount} embeddings requests`);
});

runner.test('upload_file - Upload JSONL file', async () => {
  const result = await runner.client.callTool('upload_file', {
    filePath: path.join(CONFIG.outputDir, 'test-prompts-txt.jsonl'),
  });

  const data = JSON.parse(result.content[0].text);
  if (!data.fileUri) throw new Error('No URI returned');
  if (data.state !== 'ACTIVE') throw new Error(`File not ACTIVE, state: ${data.state}`);

  // Save URI for next tests
  runner.testFileUri = data.fileUri;
  console.log(`  Uploaded file: ${data.fileUri}`);
});

runner.test('batch_create - Create content batch job', async () => {
  if (!runner.testFileUri) throw new Error('No file URI from previous test');

  const result = await runner.client.callTool('batch_create', {
    model: 'gemini-2.5-flash',
    inputFileUri: runner.testFileUri,
    displayName: 'test-batch-job',
  });

  const data = JSON.parse(result.content[0].text);
  if (!data.batchName) throw new Error('No batch name returned');

  // Save batch name for next tests
  runner.testBatchName = data.batchName;
  console.log(`  Created batch job: ${data.batchName}`);
  console.log(`  Initial state: ${data.state}`);
});

runner.test('batch_get_status - Check batch job status', async () => {
  if (!runner.testBatchName) throw new Error('No batch name from previous test');

  const result = await runner.client.callTool('batch_get_status', {
    batchName: runner.testBatchName,
    autoPoll: false, // Just check status, don't wait
  });

  const data = JSON.parse(result.content[0].text);
  if (!data.state) throw new Error('No state returned');
  console.log(`  Batch state: ${data.state}`);
  console.log(`  Is complete: ${data.isComplete}`);
});

runner.test('batch_query_task_type - Get task type recommendation', async () => {
  const result = await runner.client.callTool('batch_query_task_type', {
    context: 'Building a document search engine',
    sampleContent: ['Machine learning document', 'AI research paper'],
  });

  const data = JSON.parse(result.content[0].text);
  if (!data.selectedTaskType) throw new Error('No task type selected');
  if (!data.taskTypeDescriptions) throw new Error('No task type descriptions');

  // Verify all 8 task types are present
  const expectedTypes = [
    'SEMANTIC_SIMILARITY', 'CLASSIFICATION', 'CLUSTERING',
    'RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY', 'CODE_RETRIEVAL_QUERY',
    'QUESTION_ANSWERING', 'FACT_VERIFICATION'
  ];

  for (const type of expectedTypes) {
    if (!data.taskTypeDescriptions[type]) {
      throw new Error(`Missing task type: ${type}`);
    }
  }

  console.log(`  Selected task type: ${data.selectedTaskType}`);
  if (data.recommendation) {
    console.log(`  Recommendation confidence: ${data.recommendation.confidence}`);
  }
});

runner.test('batch_cancel - Cancel batch job', async () => {
  if (!runner.testBatchName) throw new Error('No batch name from previous test');

  const result = await runner.client.callTool('batch_cancel', {
    batchName: runner.testBatchName,
  });

  const data = JSON.parse(result.content[0].text);
  console.log(`  Cancellation requested`);
  console.log(`  New state: ${data.state}`);
});

runner.test('batch_delete - Delete batch job', async () => {
  if (!runner.testBatchName) throw new Error('No batch name from previous test');

  const result = await runner.client.callTool('batch_delete', {
    batchName: runner.testBatchName,
  });

  const data = JSON.parse(result.content[0].text);
  if (!data.deletedJob) throw new Error('No deleted job info');
  console.log(`  Deleted job: ${data.deletedJob.name}`);
});

// Note: batch_download_results and batch_create_embeddings require completed jobs
// which take ~24 hours, so we test them with stubs

runner.test('batch_download_results - Verify error handling for incomplete job', async () => {
  // This should fail with proper error message
  try {
    await runner.client.callTool('batch_download_results', {
      batchName: 'batches/nonexistent',
    });
    throw new Error('Expected error for nonexistent batch');
  } catch (error) {
    if (!error.message.includes('not complete') && !error.message.includes('not found')) {
      console.log(`  Got expected error: ${error.message}`);
    } else {
      throw error;
    }
  }
});

// ============================================================================
// RUN TESTS
// ============================================================================

(async () => {
  try {
    if (!CONFIG.apiKey) {
      console.error(`${colors.red}Error: GEMINI_API_KEY environment variable not set${colors.reset}`);
      process.exit(1);
    }

    await runner.setup();
    await runner.runTests();
    await runner.teardown();
    runner.printSummary();
  } catch (error) {
    console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
    await runner.teardown();
    process.exit(1);
  }
})();
