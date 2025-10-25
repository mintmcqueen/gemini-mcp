#!/usr/bin/env node

import {
  promptMasked,
  prompt,
  checkExistingEnvVar,
  writeToShellConfig,
  writeToClaudeCodeConfig,
  writeToClaudeDesktopConfig,
  getClaudeCodeConfigPath,
  getClaudeDesktopConfigPath,
  isInteractive,
  success,
  error as errorMsg,
  warn,
  info,
  colors,
} from './utils.js';
import { validateApiKey } from './validate-key.js';
import { existsSync } from 'fs';

/**
 * Main configuration flow
 */
async function configure() {
  console.log(`\n${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}  Gemini MCP Server Configuration${colors.reset}`);
  console.log(`${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  // Check if running interactively
  if (!isInteractive()) {
    warn('Non-interactive terminal detected');
    console.log('Set GEMINI_API_KEY environment variable manually or run in interactive terminal.\n');
    return;
  }

  // Check for existing key
  const existing = checkExistingEnvVar('GEMINI_API_KEY');
  if (existing.exists) {
    info(`Found existing GEMINI_API_KEY in: ${existing.file}`);
    const keepExisting = await prompt('Keep existing key? (y/n): ');
    if (keepExisting.toLowerCase() === 'y') {
      console.log('Configuration unchanged.\n');
      return;
    }
  }

  // Get API key from Google AI Studio
  console.log(`\n${colors.cyan}Step 1: Get your API key${colors.reset}`);
  info('Visit: https://aistudio.google.com/app/apikey');
  console.log('');

  // Prompt for API key with masking
  const apiKey = await promptMasked('Enter your Gemini API key: ');

  if (!apiKey) {
    errorMsg('No API key provided');
    process.exit(1);
  }

  // Validate API key
  console.log(`\n${colors.cyan}Step 2: Validating API key...${colors.reset}`);
  const validation = await validateApiKey(apiKey);

  if (!validation.valid) {
    errorMsg(validation.error);
    process.exit(1);
  }

  success(validation.message);
  if (validation.response) {
    console.log(`  ${colors.bright}Test response:${colors.reset} ${validation.response}`);
  }

  // Ask where to store
  console.log(`\n${colors.cyan}Step 3: Choose storage location${colors.reset}`);
  console.log('Where would you like to store your API key?\n');
  console.log('  [1] Shell environment (.zshrc / .bashrc)');
  console.log('      → Portable, works for all applications');
  console.log('');
  console.log('  [2] Claude Code (user scope)');
  console.log('      → Available across all your projects');
  console.log('');
  console.log('  [3] Claude Desktop');
  console.log('      → For Claude Desktop app only');
  console.log('');
  console.log('  [4] All of the above');
  console.log('      → Maximum compatibility\n');

  const choice = await prompt('Select option (1/2/3/4) [default: 2]: ');
  const option = choice || '2';

  console.log('');

  let shellSuccess = false;
  let claudeCodeSuccess = false;
  let claudeDesktopSuccess = false;

  // Write to shell config
  if (option === '1' || option === '4') {
    console.log(`${colors.cyan}Writing to shell configuration...${colors.reset}`);
    const result = writeToShellConfig('GEMINI_API_KEY', apiKey);
    shellSuccess = result.success;
  }

  // Write to Claude Code config
  if (option === '2' || option === '4') {
    console.log(`${colors.cyan}Writing to Claude Code configuration (user scope)...${colors.reset}`);
    const result = writeToClaudeCodeConfig(apiKey, 'user');
    claudeCodeSuccess = result.success;
  }

  // Write to Claude Desktop config
  if (option === '3' || option === '4') {
    console.log(`${colors.cyan}Writing to Claude Desktop configuration...${colors.reset}`);

    const claudeDesktopPath = getClaudeDesktopConfigPath();
    const claudeDir = claudeDesktopPath.substring(0, claudeDesktopPath.lastIndexOf('/'));

    if (!existsSync(claudeDir)) {
      warn('Claude Desktop not found at expected location');
      warn(`Expected: ${claudeDir}`);
      warn('Install Claude Desktop first, then run: npm run configure');
      if (option === '3') {
        process.exit(1);
      }
    } else {
      const result = writeToClaudeDesktopConfig(apiKey);
      claudeDesktopSuccess = result.success;
    }
  }

  // Summary
  console.log(`\n${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}  Configuration Complete${colors.reset}`);
  console.log(`${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  if (shellSuccess) {
    success('Shell environment configured');
  }
  if (claudeCodeSuccess) {
    success('Claude Code configured (user scope)');
  }
  if (claudeDesktopSuccess) {
    success('Claude Desktop configured');
  }

  console.log(`\n${colors.cyan}Next Steps:${colors.reset}\n`);

  let step = 1;

  if (shellSuccess) {
    const { configFile } = await import('./utils.js').then(m => m.detectShell());
    console.log(`  ${step}. Activate your API key:`);
    console.log(`     ${colors.bright}source ${configFile}${colors.reset}`);
    console.log(`     (or restart your terminal)\n`);
    step++;
  }

  if (claudeCodeSuccess) {
    console.log(`  ${step}. Restart Claude Code to load the new configuration\n`);
    step++;
  }

  if (claudeDesktopSuccess) {
    console.log(`  ${step}. Restart Claude Desktop to load the new configuration\n`);
    step++;
  }

  console.log(`  ${step}. Start using Gemini with Claude!\n`);

  info('You can reconfigure anytime with: npm run configure\n');
}

// Run configuration
configure().catch((err) => {
  errorMsg('Configuration failed');
  console.error(err);
  process.exit(1);
});
