#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { homedir, platform } from 'os';
import { existsSync, readFileSync, writeFileSync, appendFileSync, chmodSync } from 'fs';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Detect user's shell and appropriate config file
 */
export function detectShell() {
  const shell = process.env.SHELL || '';
  const isZsh = shell.includes('zsh');
  const isBash = shell.includes('bash');

  const home = homedir();
  const configFiles = {
    zsh: [
      join(home, '.zshrc'),
      join(home, '.zshenv'),
    ],
    bash: [
      join(home, '.bashrc'),
      join(home, '.bash_profile'),
      join(home, '.profile'),
    ],
  };

  if (isZsh) {
    return {
      shell: 'zsh',
      configFile: configFiles.zsh.find(f => existsSync(f)) || configFiles.zsh[0],
      allConfigFiles: configFiles.zsh,
    };
  } else if (isBash) {
    return {
      shell: 'bash',
      configFile: configFiles.bash.find(f => existsSync(f)) || configFiles.bash[0],
      allConfigFiles: configFiles.bash,
    };
  }

  return {
    shell: 'unknown',
    configFile: join(home, '.profile'),
    allConfigFiles: [join(home, '.profile')],
  };
}

/**
 * Get Claude Desktop config path based on platform
 */
export function getClaudeDesktopConfigPath() {
  const home = homedir();
  const plat = platform();

  switch (plat) {
    case 'darwin': // macOS
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32': // Windows
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    default: // Linux and others
      return join(home, '.config', 'Claude', 'claude_desktop_config.json');
  }
}

/**
 * Get Claude Code config path based on scope
 */
export function getClaudeCodeConfigPath(scope = 'user') {
  const home = homedir();

  switch (scope) {
    case 'user':
      return join(home, '.claude.json');
    case 'project':
      return join(process.cwd(), '.mcp.json');
    case 'local':
      return join(process.cwd(), '.claude', 'settings.local.json');
    default:
      return join(home, '.claude.json');
  }
}

/**
 * Check if running in interactive terminal
 */
export function isInteractive() {
  return process.stdin.isTTY && process.stdout.isTTY;
}

/**
 * Check if environment variable exists in any shell config
 */
export function checkExistingEnvVar(varName) {
  const { allConfigFiles } = detectShell();

  for (const file of allConfigFiles) {
    if (existsSync(file)) {
      const content = readFileSync(file, 'utf8');
      const regex = new RegExp(`^export\\s+${varName}=`, 'm');
      if (regex.test(content)) {
        return { exists: true, file };
      }
    }
  }

  // Also check current environment
  if (process.env[varName]) {
    return { exists: true, file: 'environment' };
  }

  return { exists: false, file: null };
}

/**
 * Prompt user with masked input
 */
export function promptMasked(question) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Mute output during input
    const onData = () => {
      process.stdout.write('*');
    };

    process.stdin.on('data', onData);

    rl.question(question, (answer) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      console.log(''); // New line after masked input
      resolve(answer.trim());
    });

    // Hide initial input echo
    rl._writeToOutput = () => {};
  });
}

/**
 * Prompt user with normal input
 */
export function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Write environment variable to shell config
 */
export function writeToShellConfig(varName, value) {
  const { configFile, shell } = detectShell();

  try {
    // Check if already exists
    let content = '';
    if (existsSync(configFile)) {
      content = readFileSync(configFile, 'utf8');
      const regex = new RegExp(`^export\\s+${varName}=.*$`, 'gm');

      if (regex.test(content)) {
        // Update existing entry
        content = content.replace(regex, `export ${varName}="${value}"`);
        writeFileSync(configFile, content, 'utf8');
        console.log(`✓ Updated ${varName} in ${configFile}`);
        return { success: true, file: configFile, action: 'updated' };
      }
    }

    // Append new entry
    const timestamp = new Date().toISOString();
    const entry = `\n# Gemini API Key (added by @mintmcqueen/gemini-mcp on ${timestamp})\nexport ${varName}="${value}"\n`;
    appendFileSync(configFile, entry, 'utf8');

    console.log(`✓ Added ${varName} to ${configFile}`);
    console.log(`\n⚠️  Run: source ${configFile}`);
    console.log(`   Or restart your terminal for changes to take effect.\n`);

    return { success: true, file: configFile, action: 'added' };
  } catch (error) {
    console.error(`✗ Failed to write to ${configFile}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Write or update Claude Code config (stdio MCP server)
 */
export function writeToClaudeCodeConfig(apiKey, scope = 'user') {
  const configPath = getClaudeCodeConfigPath(scope);
  const packageDir = resolve(__dirname, '..');
  const serverPath = join(packageDir, 'build', 'index.js');

  try {
    // Read existing config or create new
    let config = { mcpServers: {} };
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf8'));
        if (!config.mcpServers) {
          config.mcpServers = {};
        }
      } catch (parseError) {
        console.warn('⚠️  Existing config invalid, will create new');
        config = { mcpServers: {} };
      }
    }

    // Add or update gemini server (stdio type for Claude Code)
    config.mcpServers.gemini = {
      type: 'stdio',
      command: 'node',
      args: [serverPath],
      env: {
        GEMINI_API_KEY: apiKey,
      },
    };

    // Write atomically
    const tempPath = `${configPath}.tmp`;
    const configDir = dirname(configPath);

    // Ensure directory exists
    import('fs').then(async fs => {
      await fs.promises.mkdir(configDir, { recursive: true });

      // Write with pretty formatting
      writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');

      // Set permissions (user read/write only)
      chmodSync(tempPath, 0o600);

      // Rename to final location
      fs.renameSync(tempPath, configPath);

      console.log(`✓ Updated Claude Code config (${scope} scope): ${configPath}`);
      console.log(`\n⚠️  Restart Claude Code for changes to take effect.\n`);

      return { success: true, file: configPath, scope };
    });

    return { success: true, file: configPath, scope };
  } catch (error) {
    console.error(`✗ Failed to write Claude Code config:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Write or update Claude Desktop config
 */
export function writeToClaudeDesktopConfig(apiKey) {
  const configPath = getClaudeDesktopConfigPath();
  const packageDir = resolve(__dirname, '..');
  const serverPath = join(packageDir, 'build', 'index.js');

  try {
    // Read existing config or create new
    let config = { mcpServers: {} };
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf8'));
        if (!config.mcpServers) {
          config.mcpServers = {};
        }
      } catch (parseError) {
        console.warn('⚠️  Existing config invalid, will overwrite');
        config = { mcpServers: {} };
      }
    }

    // Add or update gemini server (no type specified for Claude Desktop)
    config.mcpServers.gemini = {
      command: 'node',
      args: [serverPath],
      env: {
        GEMINI_API_KEY: apiKey,
      },
    };

    // Write atomically
    const tempPath = `${configPath}.tmp`;
    const configDir = dirname(configPath);

    // Ensure directory exists
    import('fs').then(async fs => {
      await fs.promises.mkdir(configDir, { recursive: true });

      // Write with pretty formatting
      writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');

      // Set permissions (user read/write only)
      chmodSync(tempPath, 0o600);

      // Rename to final location
      fs.renameSync(tempPath, configPath);

      console.log(`✓ Updated Claude Desktop config: ${configPath}`);
      console.log(`\n⚠️  Restart Claude Desktop for changes to take effect.\n`);

      return { success: true, file: configPath };
    });

    return { success: true, file: configPath };
  } catch (error) {
    console.error(`✗ Failed to write Claude Desktop config:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get package installation directory
 */
export function getPackageDir() {
  return resolve(__dirname, '..');
}

/**
 * Colors for terminal output
 */
export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

/**
 * Format success message
 */
export function success(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

/**
 * Format error message
 */
export function error(msg) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

/**
 * Format warning message
 */
export function warn(msg) {
  console.log(`${colors.yellow}⚠${colors.reset}  ${msg}`);
}

/**
 * Format info message
 */
export function info(msg) {
  console.log(`${colors.cyan}ℹ${colors.reset}  ${msg}`);
}
