/**
 * @file index.ts
 * @description Barrel export for the Talox daemon/IPC module.
 */

export { generateSessionId, handleCommand } from "./commandHandler.js";
export type { DaemonCommand, DaemonConfig, DaemonResponse } from "./TaloxDaemon.js";
export { TaloxDaemon } from "./TaloxDaemon.js";
