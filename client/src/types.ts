export type InputTab = 'paste' | 'upload';
export type Quality = 'low' | 'medium' | 'high';
export type RenderMode = 'auto' | 'canvas' | 'server';
export type JobStatus = 'queued' | 'rendering' | 'encoding' | 'done' | 'error' | 'cancelled';

export interface Settings {
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  duration: number;
  quality: Quality;
  renderMode: RenderMode;
  loopCheck: boolean;
}

export interface DetectionResult {
  canvasDetected: boolean;
  drawDetected: boolean;
  recommendedMode: Exclude<RenderMode, 'auto'> | null;
  reason: string;
}

export interface RenderProgress {
  status: JobStatus;
  framesDone: number;
  totalFrames: number;
  etaSeconds: number | null;
  elapsedSeconds: number;
  message?: string;
}

export interface LoopCheckResult {
  passed: boolean;
  meanAbsoluteDifference: number;
  threshold: number;
  message: string;
}

export interface VideoResult {
  url: string;
  fileSize: number;
  width: number;
  height: number;
  duration: number;
  loopCheck: LoopCheckResult | null;
  sizeBytes?: number | null;
}

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  framesDone: number;
  totalFrames: number;
  etaSeconds: number | null;
  elapsedSeconds: number;
  error?: string;
  videoReady: boolean;
  loopCheck: LoopCheckResult | null;
  sizeBytes?: number | null;
}

export interface ConsoleEntry {
  type: 'log' | 'info' | 'warn' | 'error';
  message: string;
  time: string;
}
