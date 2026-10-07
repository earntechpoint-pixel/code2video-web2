import path from 'node:path';
import type { ServerConfig } from '../types.js';

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig(): ServerConfig {
  return {
    port: numberEnv('PORT', 3001),
    host: process.env.HOST || '0.0.0.0',
    clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    maxUploadBytes: Math.max(1, numberEnv('MAX_UPLOAD_MB', 5)) * 1024 * 1024,
    maxDuration: Math.min(120, Math.max(1, numberEnv('MAX_DURATION_SECONDS', 120))),
    maxWidth: Math.min(3840, Math.max(160, numberEnv('MAX_WIDTH', 3840))),
    maxHeight: Math.min(2160, Math.max(90, numberEnv('MAX_HEIGHT', 2160))),
    maxConcurrentJobs: Math.min(32, Math.max(1, numberEnv('MAX_CONCURRENT_JOBS', 2))),
    workerCount: Math.min(4, Math.max(2, numberEnv('WORKER_COUNT', 2))),
    jobTimeoutMs: Math.max(60_000, numberEnv('JOB_TIMEOUT_MS', 900_000)),
    frameTimeoutMs: Math.max(1_000, numberEnv('FRAME_TIMEOUT_MS', 15_000)),
    jobTtlMs: Math.max(60_000, numberEnv('JOB_TTL_MS', 3_600_000)),
    rateLimitWindowMs: Math.max(1_000, numberEnv('RATE_LIMIT_WINDOW_MS', 60_000)),
    rateLimitMax: Math.max(1, numberEnv('RATE_LIMIT_MAX', 20)),
    tmpRoot: path.resolve(process.env.TMP_ROOT || './tmp/jobs'),
  };
}
