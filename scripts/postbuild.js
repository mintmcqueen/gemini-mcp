#!/usr/bin/env node

/**
 * Post-build script to ensure the output file is executable
 * This is necessary because TypeScript compilation doesn't preserve file permissions
 */

import { chmodSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const buildFile = join(__dirname, '..', 'build', 'index.js');

try {
  // Make the file executable (755 = rwxr-xr-x)
  chmodSync(buildFile, 0o755);
  console.log('✓ Set executable permissions on build/index.js');
} catch (error) {
  console.error('✗ Failed to set permissions:', error.message);
  process.exit(1);
}
