#!/usr/bin/env node

import {
  promptMasked,
  prompt,
  checkExistingEnvVar,
  writeToShellConfig,
  writeToClaudeCodeConfig,
  writeToClaudeDesktopConfig,
  isInteractive,
  success,
  error as errorMsg,
  warn,
  info,
  colors,
} from './utils.js';
import { validateApiKey } from './validate-key.js';

/**
 * Detect if installation is via Claude Code's MCP add command
 */
function isClaudeMcpInstall() {
  // Check environment hints that suggest Claude Code is managing this
  return (
    process.env.CLAUDE_MCP_INSTALL === 'true' ||
    process.env.MCP_INSTALL === 'true' ||
    process.cwd().includes('claude') ||
    process.cwd().includes('mcp')
  );
}

/**
 * Quick setup for claude mcp add workflow
 */
async function quickSetup() {
  console.log(`\n${colors.cyan}⚡ Gemini MCP Server - Quick Setup${colors.reset}\n`);

  // Check if key already exists
  const existing = checkExistingEnvVar('GEMINI_API_KEY');
  if (existing.exists && process.env.GEMINI_API_KEY) {
    success('Found existing GEMINI_API_KEY in environment');
    info('Server will use existing API key');
    console.log('');
    return { configured: true, source: 'existing' };
  }

  if (!isInteractive()) {
    warn('API key not found and terminal is non-interactive');
    console.log('');
    console.log(`${colors.bright}Manual setup required:${colors.reset}`);
    console.log(`  1. Get API key from: https://aistudio.google.com/app/apikey`);
    console.log(`  2. Run: npm run configure`);
    console.log(`     or set GEMINI_API_KEY environment variable\n`);
    return { configured: false, source: 'manual-needed' };
  }

  // Interactive setup
  console.log('This server requires a Google Gemini API key.\n');
  info('Get your free API key: https://aistudio.google.com/app/apikey\n');

  const hasKey = await prompt('Do you have your API key ready? (y/n): ');

  if (hasKey.toLowerCase() !== 'y') {
    console.log('');
    info('No problem! Get your key and then run:');
    console.log(`  ${colors.bright}npm run configure${colors.reset}\n`);
    return { configured: false, source: 'deferred' };
  }

  // Get and validate API key
  console.log('');
  const apiKey = await promptMasked('Enter your Gemini API key: ');

  if (!apiKey) {
    warn('No API key provided');
    console.log('\nRun npm run configure when ready.\n');
    return { configured: false, source: 'skipped' };
  }

  // Validate
  console.log(`\n${colors.cyan}Validating API key...${colors.reset}`);
  const validation = await validateApiKey(apiKey);

  if (!validation.valid) {
    errorMsg(validation.error);
    console.log('\nRun npm run configure to try again.\n');
    return { configured: false, source: 'invalid' };
  }

  success(validation.message);

  // For claude mcp add, automatically configure in Claude Code config (user scope)
  console.log(`\n${colors.cyan}Configuring server...${colors.reset}`);
  const result = writeToClaudeCodeConfig(apiKey, 'user');

  if (result.success) {
    success('Server configured successfully in Claude Code (user scope)!');
    console.log('');
    info('Restart Claude Code to start using Gemini');
    console.log('');
    return { configured: true, source: 'new-config' };
  } else {
    warn('Could not auto-configure - manual setup needed');
    console.log('\nRun npm run configure for guided setup.\n');
    return { configured: false, source: 'config-failed' };
  }
}

/**
 * Full interactive setup (for manual npm install)
 */
async function fullSetup() {
  console.log(`\n${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}  Gemini MCP Server - Installation${colors.reset}`);
  console.log(`${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  // Check for existing key
  const existing = checkExistingEnvVar('GEMINI_API_KEY');
  if (existing.exists) {
    success(`Found existing GEMINI_API_KEY in: ${existing.file}`);
    info('Installation complete - server will use existing key\n');
    return { configured: true, source: 'existing' };
  }

  if (!isInteractive()) {
    info('Non-interactive installation detected\n');
    console.log(`${colors.bright}Setup Options:${colors.reset}\n`);
    console.log('  1. Set environment variable:');
    console.log(`     export GEMINI_API_KEY="your-api-key-here"\n`);
    console.log('  2. Run interactive setup:');
    console.log(`     npm run configure\n`);
    console.log('  3. Get API key from:');
    console.log(`     https://aistudio.google.com/app/apikey\n`);
    return { configured: false, source: 'non-interactive' };
  }

  // Ask if user wants to configure now
  console.log(`${colors.cyan}API Key Setup${colors.reset}\n`);
  console.log('Gemini MCP Server requires a Google Gemini API key.\n');
  info('Get your free key: https://aistudio.google.com/app/apikey\n');

  const configureNow = await prompt('Configure API key now? (y/n) [y]: ');

  if (configureNow.toLowerCase() === 'n') {
    console.log('');
    info('Skipping configuration');
    console.log('\nRun npm run configure when ready.\n');
    return { configured: false, source: 'deferred' };
  }

  // Run full configuration
  console.log('');
  console.log('Starting configuration wizard...\n');

  try {
    // Import and run configure
    const { default: configure } = await import('./configure.js');
    return { configured: true, source: 'wizard' };
  } catch (err) {
    errorMsg('Configuration wizard failed');
    console.log('\nRun npm run configure to try again.\n');
    return { configured: false, source: 'wizard-failed' };
  }
}

/**
 * Main installation entry point
 */
async function install() {
  try {
    // Detect installation context
    const isMcpInstall = isClaudeMcpInstall();

    if (isMcpInstall) {
      // Quick setup for claude mcp add workflow
      await quickSetup();
    } else {
      // Full setup for manual npm install
      await fullSetup();
    }
  } catch (err) {
    errorMsg('Installation error');
    console.error(err);
    console.log('');
    info('Run npm run configure for manual setup\n');
    // Don't exit with error - allow installation to complete
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  install();
}

export default install;
