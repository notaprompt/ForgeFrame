/**
 * @forgeframe/core — Resource Budget Detection
 *
 * Detects host machine resources to inform organ activation decisions.
 */

import * as os from 'os';
import type { ResourceBudget } from './organ-types.js';

export function detectResourceBudget(): ResourceBudget {
  const totalRamMb = Math.floor(os.totalmem() / (1024 * 1024));
  const availableRamMb = Math.floor(os.freemem() / (1024 * 1024));
  const compute: string[] = [];
  if (process.platform === 'darwin') compute.push('metal');
  // Apple Silicon: unified memory — GPU can access ~75% of total RAM
  const totalVramMb = compute.includes('metal') ? Math.floor(totalRamMb * 0.75) : 0;
  const availableVramMb = compute.includes('metal') ? Math.floor(availableRamMb * 0.75) : 0;

  return { totalRamMb, totalVramMb, availableRamMb, availableVramMb, compute, networkAllowed: true };
}
