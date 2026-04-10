/**
 * @forgeframe/server — Token Management
 *
 * Generates, stores, and manages API bearer tokens.
 * Token stored in ~/.forgeframe/token (plain text, 0600 permissions).
 * Server reads from FORGEFRAME_TOKEN env var or falls back to this file.
 */

import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync } from 'fs';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const FORGEFRAME_DIR = resolve(homedir(), '.forgeframe');
const TOKEN_PATH = resolve(FORGEFRAME_DIR, 'token');

/**
 * Generate a cryptographically secure token, save it, and print setup instructions.
 */
export function generateToken(): string {
  mkdirSync(FORGEFRAME_DIR, { recursive: true });

  const token = 'ff_' + randomBytes(32).toString('base64url');

  writeFileSync(TOKEN_PATH, token, 'utf-8');
  chmodSync(TOKEN_PATH, 0o600);

  process.stdout.write('\n');
  process.stdout.write(`  Token generated: ${token}\n`);
  process.stdout.write('\n');
  process.stdout.write('  To activate, add to your shell profile:\n');
  process.stdout.write('\n');
  process.stdout.write(`    export FORGEFRAME_TOKEN="${token}"\n`);
  process.stdout.write('\n');
  process.stdout.write('  Then restart the daemon:\n');
  process.stdout.write('\n');
  process.stdout.write('    forgeframe stop && forgeframe start\n');
  process.stdout.write('\n');
  process.stdout.write(`  Token saved to ${TOKEN_PATH}\n`);
  process.stdout.write('  The Cockpit will prompt for this token on first load.\n');
  process.stdout.write('\n');

  return token;
}

/**
 * Show the current token if one exists. Returns true if found.
 */
export function showToken(): boolean {
  // Check env first
  const envToken = process.env.FORGEFRAME_TOKEN;
  if (envToken) {
    process.stdout.write(`\n  Active token (from env): ${envToken}\n\n`);
    return true;
  }

  // Check file
  if (existsSync(TOKEN_PATH)) {
    const token = readFileSync(TOKEN_PATH, 'utf-8').trim();
    if (token) {
      process.stdout.write(`\n  Saved token: ${token}\n`);
      process.stdout.write('  (not active — set FORGEFRAME_TOKEN env var to activate)\n\n');
      return true;
    }
  }

  process.stdout.write('\n  No token configured. Run "forgeframe token generate" to create one.\n\n');
  return false;
}

/**
 * Revoke the current token by deleting the file.
 */
export function revokeToken(): void {
  if (existsSync(TOKEN_PATH)) {
    unlinkSync(TOKEN_PATH);
    process.stdout.write('\n  Token revoked. File deleted.\n');
  } else {
    process.stdout.write('\n  No token file found.\n');
  }

  if (process.env.FORGEFRAME_TOKEN) {
    process.stdout.write('  Note: FORGEFRAME_TOKEN is still set in your environment.\n');
    process.stdout.write('  Remove it from your shell profile and restart the daemon.\n');
  }

  process.stdout.write('\n');
}

/**
 * Load token from env or file. Used by the server at startup.
 */
export function loadToken(): string | undefined {
  const envToken = process.env.FORGEFRAME_TOKEN;
  if (envToken) return envToken;

  if (existsSync(TOKEN_PATH)) {
    const token = readFileSync(TOKEN_PATH, 'utf-8').trim();
    if (token) return token;
  }

  return undefined;
}
