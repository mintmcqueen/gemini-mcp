#!/usr/bin/env node

import { GoogleGenAI } from '@google/genai';

/**
 * Validate API key format
 */
export function validateFormat(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return { valid: false, error: 'API key is required' };
  }

  if (apiKey.length < 20) {
    return { valid: false, error: 'API key too short' };
  }

  // Gemini API keys typically start with "AIza"
  if (!apiKey.startsWith('AIza')) {
    return {
      valid: false,
      error: 'Invalid format - Gemini API keys should start with "AIza"',
    };
  }

  return { valid: true };
}

/**
 * Test API key with actual Gemini API call
 */
export async function testApiKey(apiKey) {
  try {
    const genAI = new GoogleGenAI({ apiKey });

    // Make a minimal test request
    const result = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: ['Say "test successful" if you can read this.'],
      config: {
        maxOutputTokens: 10,
        temperature: 0,
      },
    });

    const response = result.text;

    if (response && response.length > 0) {
      return {
        valid: true,
        message: 'API key validated successfully',
        response: response.substring(0, 50), // First 50 chars
      };
    }

    return {
      valid: false,
      error: 'API returned empty response',
    };
  } catch (error) {
    // Parse error types
    if (error.message?.includes('API key not valid') ||
        error.message?.includes('INVALID_ARGUMENT') ||
        error.status === 400) {
      return {
        valid: false,
        error: 'Invalid API key - please check your key from Google AI Studio',
      };
    }

    if (error.message?.includes('quota') || error.status === 429) {
      return {
        valid: false,
        error: 'API quota exceeded - key may be valid but rate limited',
      };
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      return {
        valid: false,
        error: 'Network error - please check your internet connection',
      };
    }

    return {
      valid: false,
      error: `Validation failed: ${error.message}`,
    };
  }
}

/**
 * Full validation: format + API test
 */
export async function validateApiKey(apiKey) {
  // First check format
  const formatCheck = validateFormat(apiKey);
  if (!formatCheck.valid) {
    return formatCheck;
  }

  // Then test with actual API
  console.log('Testing API key with Gemini...');
  const apiTest = await testApiKey(apiKey);

  return apiTest;
}

/**
 * CLI usage
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const apiKey = process.argv[2];

  if (!apiKey) {
    console.error('Usage: node validate-key.js <API_KEY>');
    process.exit(1);
  }

  validateApiKey(apiKey).then((result) => {
    if (result.valid) {
      console.log('✓', result.message);
      if (result.response) {
        console.log('  Response:', result.response);
      }
      process.exit(0);
    } else {
      console.error('✗', result.error);
      process.exit(1);
    }
  });
}
