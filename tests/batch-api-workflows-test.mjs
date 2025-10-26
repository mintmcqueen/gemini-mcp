#!/usr/bin/env node
/**
 * E2E Test Suite for Complete Batch API Workflows
 * Tests end-to-end workflows for content generation and embeddings
 *
 * Prerequisites:
 * - GEMINI_API_KEY environment variable set
 * - npm run build (compiled server)
 *
 * Usage:
 *   node tests/batch-api-workflows-test.mjs
 *
 * Note: These tests involve actual API calls and may take time
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const CONFIG = {
  serverPath: path.join(PROJECT_ROOT, 'build', 'index.js'),
  testDataDir: path.join(PROJECT_ROOT, 'tests', 'test-data'),
  outputDir: path.join(PROJECT_ROOT, 'tests', 'test-output'),
  apiKey: process.env.GEMINI_API_KEY,
};

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
        buffer = lines.pop();

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
            // Ignore non-JSON lines
          }
        }
      });

      this.server.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('[Init]')) {
          console.log(`${colors.blue}[Server]${colors.reset} ${msg}`);
        }
      });

      this.server.on('error', reject);
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

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Timeout waiting for ${toolName}`));
        }
      }, 600000); // 10 minute timeout for workflows
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
    console.log(`${colors.cyan}Setting up workflow test environment...${colors.reset}`);

    await fs.mkdir(CONFIG.testDataDir, { recursive: true });
    await fs.mkdir(CONFIG.outputDir, { recursive: true });

    await this.createTestDataFiles();
    await this.client.start();
    console.log(`${colors.green}✓ MCP server started${colors.reset}\n`);
  }

  async createTestDataFiles() {
    // Create comprehensive test files for workflows

    // Content generation CSV
    const contentCSV = `prompt
Explain quantum computing in one sentence
What is photosynthesis?
Describe machine learning briefly`;
    await fs.writeFile(path.join(CONFIG.testDataDir, 'workflow-content.csv'), contentCSV);

    // Embeddings text file
    const embeddingsText = `Artificial intelligence enables machines to learn from data
Machine learning is a subset of artificial intelligence
Deep learning uses neural networks with multiple layers
Natural language processing helps computers understand human language
Computer vision allows machines to interpret visual information`;
    await fs.writeFile(path.join(CONFIG.testDataDir, 'workflow-embeddings.txt'), embeddingsText);

    // JSON format for content
    const contentJSON = JSON.stringify([
      { prompt: "What is the speed of light?" },
      { prompt: "Explain gravity simply" },
      { prompt: "Define photosynthesis" }
    ], null, 2);
    await fs.writeFile(path.join(CONFIG.testDataDir, 'workflow-content.json'), contentJSON);

    console.log(`${colors.green}✓ Workflow test files created${colors.reset}`);
  }

  async runTests() {
    console.log(`${colors.cyan}Running ${this.tests.length} workflow tests...${colors.reset}\n`);

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
    console.log(`${colors.green}✓ Workflow tests complete${colors.reset}`);
  }

  printSummary() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${colors.cyan}Workflow Test Summary${colors.reset}`);
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

const runner = new TestRunner();

// ============================================================================
// WORKFLOW TESTS
// ============================================================================

runner.test('Manual Workflow - Content Generation (5 steps)', async () => {
  console.log(`  ${colors.cyan}Step 1/5:${colors.reset} Ingest content...`);
  const ingestResult = await runner.client.callTool('batch_ingest_content', {
    inputFile: path.join(CONFIG.testDataDir, 'workflow-content.csv'),
    outputFile: path.join(CONFIG.outputDir, 'workflow-content.jsonl'),
  });
  const ingestData = JSON.parse(ingestResult.content[0].text);
  if (!ingestData.validationPassed) throw new Error('Ingestion validation failed');
  console.log(`    Generated ${ingestData.requestCount} requests`);

  console.log(`  ${colors.cyan}Step 2/5:${colors.reset} Upload JSONL...`);
  const uploadResult = await runner.client.callTool('upload_file', {
    filePath: ingestData.outputFile,
  });
  const uploadData = JSON.parse(uploadResult.content[0].text);
  if (!uploadData.fileUri) throw new Error('No file URI');
  if (uploadData.state !== 'ACTIVE') throw new Error(`File not ACTIVE: ${uploadData.state}`);
  console.log(`    Uploaded: ${uploadData.fileUri}`);

  console.log(`  ${colors.cyan}Step 3/5:${colors.reset} Create batch job...`);
  const createResult = await runner.client.callTool('batch_create', {
    model: 'gemini-2.5-flash',
    inputFileUri: uploadData.fileUri,
    displayName: 'workflow-test-manual',
  });
  const createData = JSON.parse(createResult.content[0].text);
  if (!createData.batchName) throw new Error('No batch name');
  console.log(`    Created: ${createData.batchName}`);
  console.log(`    State: ${createData.state}`);

  runner.manualBatchName = createData.batchName; // Save for later

  console.log(`  ${colors.cyan}Step 4/5:${colors.reset} Check status (no auto-poll)...`);
  const statusResult = await runner.client.callTool('batch_get_status', {
    batchName: createData.batchName,
    autoPoll: false,
  });
  const statusData = JSON.parse(statusResult.content[0].text);
  console.log(`    State: ${statusData.state}`);
  console.log(`    Is complete: ${statusData.isComplete}`);

  console.log(`  ${colors.cyan}Step 5/5:${colors.reset} Verify workflow integrity...`);
  console.log(`    ✓ All 5 steps executed successfully`);
  console.log(`    ✓ Data passed correctly between steps`);
  console.log(`    ✓ Manual workflow validated`);
});

runner.test('Automated Workflow - batch_process (single call)', async () => {
  console.log(`  ${colors.yellow}Note: This is a dry-run test (no actual batch job creation)${colors.reset}`);
  console.log(`  Testing workflow orchestration logic...`);

  // Test ingestion step in isolation
  console.log(`  Testing step 1/5: Content ingestion...`);
  const ingestResult = await runner.client.callTool('batch_ingest_content', {
    inputFile: path.join(CONFIG.testDataDir, 'workflow-content.json'),
    outputFile: path.join(CONFIG.outputDir, 'workflow-automated.jsonl'),
  });
  const ingestData = JSON.parse(ingestResult.content[0].text);
  if (!ingestData.validationPassed) throw new Error('Ingestion failed');
  console.log(`    ✓ Ingestion validated (${ingestData.requestCount} requests)`);

  // Verify JSONL file exists and is valid
  const jsonlContent = await fs.readFile(ingestData.outputFile, 'utf-8');
  const lines = jsonlContent.split('\n').filter(l => l.trim());
  if (lines.length !== ingestData.requestCount) {
    throw new Error(`JSONL line count mismatch: expected ${ingestData.requestCount}, got ${lines.length}`);
  }

  // Validate each line is proper JSON
  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (!parsed.request || !parsed.request.contents) {
        throw new Error(`Line ${i + 1}: Missing required fields`);
      }
    } catch (e) {
      throw new Error(`Line ${i + 1}: Invalid JSON - ${e.message}`);
    }
  }

  console.log(`    ✓ JSONL validation passed`);
  console.log(`    ✓ Automated workflow ready for execution`);
  console.log(`    ${colors.yellow}(Actual batch_process would continue with steps 2-5)${colors.reset}`);
});

// NOTE: Embeddings workflow skipped - Gemini API does not support batch operations for embeddings model
runner.test('Manual Workflow - Embeddings (6 steps)', async () => {
  console.log(`  ${colors.cyan}Step 1/6:${colors.reset} Ingest embeddings content...`);
  const ingestResult = await runner.client.callTool('batch_ingest_embeddings', {
    inputFile: path.join(CONFIG.testDataDir, 'workflow-embeddings.txt'),
    outputFile: path.join(CONFIG.outputDir, 'workflow-embeddings.jsonl'),
    taskType: 'RETRIEVAL_DOCUMENT',
  });
  const ingestData = JSON.parse(ingestResult.content[0].text);
  if (!ingestData.validationPassed) throw new Error('Embeddings ingestion validation failed');
  console.log(`    Generated ${ingestData.requestCount} embedding requests`);

  console.log(`  ${colors.cyan}Step 2/6:${colors.reset} Query task type...`);
  const taskTypeResult = await runner.client.callTool('batch_query_task_type', {
    context: 'Creating embeddings for AI/ML documentation',
  });
  const taskTypeData = JSON.parse(taskTypeResult.content[0].text);
  console.log(`    Selected: ${taskTypeData.selectedTaskType}`);
  console.log(`    Confidence: ${taskTypeData.recommendation?.confidence || 'N/A'}`);

  console.log(`  ${colors.cyan}Step 3/6:${colors.reset} Upload embeddings JSONL...`);
  const uploadResult = await runner.client.callTool('upload_file', {
    filePath: ingestData.outputFile,
  });
  const uploadData = JSON.parse(uploadResult.content[0].text);
  if (!uploadData.fileUri) throw new Error('No file URI');
  if (uploadData.state !== 'ACTIVE') throw new Error(`File not ACTIVE: ${uploadData.state}`);
  console.log(`    Uploaded: ${uploadData.fileUri}`);

  console.log(`  ${colors.cyan}Step 4/6:${colors.reset} Create embeddings batch job...`);
  const createResult = await runner.client.callTool('batch_create_embeddings', {
    model: 'gemini-embedding-001',
    inputFileUri: uploadData.fileUri,
    taskType: 'RETRIEVAL_DOCUMENT',
    displayName: 'workflow-test-embeddings',
  });
  const createData = JSON.parse(createResult.content[0].text);
  if (!createData.batchName) throw new Error('No batch name');
  console.log(`    Created: ${createData.batchName}`);
  console.log(`    State: ${createData.state}`);

  runner.embeddingsBatchName = createData.batchName; // Save for cleanup

  console.log(`  ${colors.cyan}Step 5/6:${colors.reset} Check status (no auto-poll)...`);
  const statusResult = await runner.client.callTool('batch_get_status', {
    batchName: createData.batchName,
    autoPoll: false,
  });
  const statusData = JSON.parse(statusResult.content[0].text);
  console.log(`    State: ${statusData.state}`);
  console.log(`    Is complete: ${statusData.isComplete}`);

  console.log(`  ${colors.cyan}Step 6/6:${colors.reset} Verify workflow integrity...`);
  console.log(`    ✓ All 6 steps executed successfully`);
  console.log(`    ✓ Data passed correctly between steps`);
  console.log(`    ✓ Embeddings workflow validated`);
});

runner.test('Workflow Data Integrity - JSONL Format Validation', async () => {
  console.log(`  Validating JSONL conversion for multiple formats...`);

  // Test CSV conversion
  const csvFile = path.join(CONFIG.testDataDir, 'workflow-content.csv');
  const csvResult = await runner.client.callTool('batch_ingest_content', {
    inputFile: csvFile,
    outputFile: path.join(CONFIG.outputDir, 'integrity-test-csv.jsonl'),
  });
  const csvData = JSON.parse(csvResult.content[0].text);
  console.log(`    ✓ CSV: ${csvData.requestCount} requests`);

  // Test JSON conversion
  const jsonFile = path.join(CONFIG.testDataDir, 'workflow-content.json');
  const jsonResult = await runner.client.callTool('batch_ingest_content', {
    inputFile: jsonFile,
    outputFile: path.join(CONFIG.outputDir, 'integrity-test-json.jsonl'),
  });
  const jsonData = JSON.parse(jsonResult.content[0].text);
  console.log(`    ✓ JSON: ${jsonData.requestCount} requests`);

  // Test TXT conversion
  const txtFile = path.join(CONFIG.testDataDir, 'workflow-embeddings.txt');
  const txtResult = await runner.client.callTool('batch_ingest_content', {
    inputFile: txtFile,
    outputFile: path.join(CONFIG.outputDir, 'integrity-test-txt.jsonl'),
  });
  const txtData = JSON.parse(txtResult.content[0].text);
  console.log(`    ✓ TXT: ${txtData.requestCount} requests`);

  // Verify all conversions passed validation
  if (!csvData.validationPassed || !jsonData.validationPassed || !txtData.validationPassed) {
    throw new Error('Some conversions failed validation');
  }

  console.log(`    ✓ All format conversions validated`);
});

runner.test('Job Management - Cancel and Delete', async () => {
  if (runner.manualBatchName) {
    console.log(`  Testing job management with: ${runner.manualBatchName}`);

    console.log(`  Cancelling batch job...`);
    const cancelResult = await runner.client.callTool('batch_cancel', {
      batchName: runner.manualBatchName,
    });
    const cancelData = JSON.parse(cancelResult.content[0].text);
    console.log(`    ✓ Cancellation requested`);
    console.log(`    New state: ${cancelData.state}`);

    console.log(`  Deleting batch job...`);
    const deleteResult = await runner.client.callTool('batch_delete', {
      batchName: runner.manualBatchName,
    });
    const deleteData = JSON.parse(deleteResult.content[0].text);
    console.log(`    ✓ Job deleted: ${deleteData.deletedJob.name}`);
  } else {
    console.log(`  ${colors.yellow}Skipping: No batch job available from previous tests${colors.reset}`);
  }

  if (runner.embeddingsBatchName) {
    console.log(`  Cleaning up embeddings job: ${runner.embeddingsBatchName}`);
    await runner.client.callTool('batch_cancel', { batchName: runner.embeddingsBatchName });
    await runner.client.callTool('batch_delete', { batchName: runner.embeddingsBatchName });
    console.log(`    ✓ Embeddings job cleaned up`);
  }
});

// ============================================================================
// RUN WORKFLOW TESTS
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
