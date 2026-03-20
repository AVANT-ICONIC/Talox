/**
 * @file config.ts
 * @description TaloxConfig - what you pass to TaloxController constructor
 */

import type { TaloxSettings } from './settings.js';

export interface TaloxConfig {
  profile?: string;                    // session profile name (default: 'default')
  observe?: boolean;                   // human drives, agent watches (default: false)
  settings?: Partial<TaloxSettings>;   // override any default setting
  humanTakeover?: boolean | {
    timeoutMs?: number;                // 0 = wait forever (default: 120000 = 2min)
  };
}
