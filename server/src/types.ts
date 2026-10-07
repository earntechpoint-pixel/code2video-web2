export type Quality = 'low' | 'medium' | 'high';
export type RenderMode = 'server' | 'canvas';
export type JobStatus = 'queued' | 'rendering' | 'encoding' | 'done' | 'error' | 'cancelled';

export interface RenderSettings {
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  duration: number;
  quality: Quality;
  renderMode: RenderMode;
  loopCheck: boolean;
}

export interface LoopCheckResult {
  passed: boolean;
  meanAbsoluteDifference: number;
  threshold: number;
  message: string;
}

export interface JobState {
  jobId: string;
  status: JobStatus;
  framesDone: number;
  totalFrames: number;
  etaSeconds: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  error?: string;
  videoPath?: string;
  videoSizeBytes?: number;
  htmlPath: string;
  audioPath?: string;
  settings: RenderSettings;
  loopCheck: LoopCheckResult | null;
  cancelRequested: boolean;
  clients: Set<import('express').Response>;
}

export interface ServerConfig {
  port: number;
  host: string;
  clientOrigin: string;
  maxUploadBytes: number;
  maxDuration: number;
  maxWidth: number;
  maxHeight: number;
  maxConcurrentJobs: number;
  workerCount: number;
  jobTimeoutMs: number;
  frameTimeoutMs: number;
  jobTtlMs: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  tmpRoot: string;
}
