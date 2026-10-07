import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { encodeMp4 } from './render/ffmpegEncoder.js';
import { renderServerFrames } from './render/playwrightRenderer.js';
import type { JobState, RenderSettings, ServerConfig } from './types.js';
import { safeFileName } from './lib/pathSecurity.js';
import { totalFrames } from './lib/validation.js';

export class JobManager {
  private readonly jobs = new Map<string, JobState>();
  private readonly queue: string[] = [];
  private active = 0;
  private readonly cleanupTimer: NodeJS.Timeout;
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly config: ServerConfig) {
    this.cleanupTimer = setInterval(() => void this.cleanupExpired(), 60_000);
    this.cleanupTimer.unref();
  }

  async createJob(html: string, settings: RenderSettings, audioBuffer?: Buffer, originalHtmlName = 'animation.html'): Promise<JobState> {
    const jobId = randomUUID();
    const root = path.join(this.config.tmpRoot, jobId);
    await fs.mkdir(root, { recursive: true });
    const htmlPath = path.join(root, safeFileName(originalHtmlName));
    await fs.writeFile(htmlPath, html, 'utf8');
    let audioPath: string | undefined;
    if (audioBuffer) {
      audioPath = path.join(root, 'audio.bin');
      await fs.writeFile(audioPath, audioBuffer);
    }
    const job: JobState = {
      jobId,
      status: 'queued',
      framesDone: 0,
      totalFrames: totalFrames(settings),
      etaSeconds: null,
      startedAt: null,
      finishedAt: null,
      htmlPath,
      audioPath,
      settings,
      loopCheck: null,
      cancelRequested: false,
      clients: new Set<Response>(),
    };
    this.jobs.set(jobId, job);
    this.queue.push(jobId);
    this.broadcast(job);
    void this.pump();
    return job;
  }

  get(jobId: string): JobState | undefined {
    return this.jobs.get(jobId);
  }

  subscribe(jobId: string, response: Response): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    this.writeSse(response, job);
    if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
      response.end();
      return true;
    }
    job.clients.add(response);
    return true;
  }

  unsubscribe(jobId: string, response: Response): void {
    this.jobs.get(jobId)?.clients.delete(response);
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.cancelRequested = true;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.finishedAt = Date.now();
      this.broadcast(job);
      for (const response of job.clients) response.end();
      job.clients.clear();
      void this.cleanupJobFiles(job, true);
    }
    return true;
  }

  async shutdown(): Promise<void> {
    clearInterval(this.cleanupTimer);
    for (const job of this.jobs.values()) job.cancelRequested = true;
    this.queue.length = 0;
    await Promise.allSettled([...this.running]);
    await Promise.all([...this.jobs.values()].map((job) => this.cleanupJobFiles(job, true)));
    this.jobs.clear();
  }

  private async pump(): Promise<void> {
    while (this.active < this.config.maxConcurrentJobs && this.queue.length > 0) {
      const jobId = this.queue.shift();
      if (!jobId) break;
      const job = this.jobs.get(jobId);
      if (!job || job.cancelRequested || job.status !== 'queued') continue;
      this.active += 1;
      const work = this.process(job);
      this.running.add(work);
      void work.finally(() => {
        this.running.delete(work);
        this.active -= 1;
        void this.pump();
      }).catch(() => undefined);
    }
  }

  private async process(job: JobState): Promise<void> {
    job.startedAt = Date.now();
    this.setStatus(job, 'rendering');
    const timeout = setTimeout(() => { job.cancelRequested = true; }, this.config.jobTimeoutMs);
    try {
      const rendered = await renderServerFrames(job, this.config, {
        isCancelled: () => job.cancelRequested,
        onFramesDone: (done) => this.updateProgress(job, done),
        onStatus: (status) => this.setStatus(job, status),
      });
      if (job.cancelRequested) throw new DOMException('Job cancelled.', 'AbortError');
      job.loopCheck = rendered.loopCheck;
      this.setStatus(job, 'encoding');
      const videoPath = path.join(path.dirname(job.htmlPath), 'result.mp4');
      await encodeMp4(
        rendered.framesDir,
        videoPath,
        job.settings,
        job.audioPath,
        () => job.cancelRequested,
        () => this.setStatus(job, 'encoding'),
      );
      if (job.cancelRequested) throw new DOMException('Job cancelled.', 'AbortError');
      job.videoPath = videoPath;
      job.videoSizeBytes = (await fs.stat(videoPath)).size;
      job.finishedAt = Date.now();
      this.setStatus(job, 'done');
      await fs.rm(rendered.framesDir, { recursive: true, force: true });
      if (job.audioPath) await fs.rm(job.audioPath, { force: true });
    } catch (error) {
      job.finishedAt = Date.now();
      if (job.cancelRequested || (error instanceof DOMException && error.name === 'AbortError')) {
        job.status = 'cancelled';
        this.broadcast(job);
        await this.cleanupJobFiles(job, true);
      } else {
        job.error = this.sanitizeError(error instanceof Error ? error.message : 'The server could not render this animation.', path.dirname(job.htmlPath));
        this.setStatus(job, 'error');
        await this.cleanupJobFiles(job, true, false);
      }
    } finally {
      clearTimeout(timeout);
      for (const response of job.clients) response.end();
      job.clients.clear();
    }
  }

  private sanitizeError(message: string, jobRoot: string): string {
    return message.replaceAll(jobRoot, '[job-data]').slice(0, 1500);
  }

  private updateProgress(job: JobState, done: number): void {
    job.framesDone = Math.min(done, job.totalFrames);
    if (job.startedAt) {
      const elapsed = (Date.now() - job.startedAt) / 1000;
      const rate = job.framesDone / Math.max(elapsed, 0.001);
      job.etaSeconds = rate > 0 ? Math.max(0, (job.totalFrames - job.framesDone) / rate) : null;
    }
    this.broadcast(job);
  }

  private setStatus(job: JobState, status: JobState['status']): void {
    job.status = status;
    this.broadcast(job);
  }

  private toPublic(job: JobState): object {
    return {
      jobId: job.jobId,
      status: job.status,
      framesDone: job.framesDone,
      totalFrames: job.totalFrames,
      etaSeconds: job.etaSeconds,
      elapsedSeconds: job.startedAt ? ((job.finishedAt ?? Date.now()) - job.startedAt) / 1000 : 0,
      error: job.error,
      videoReady: Boolean(job.videoPath && job.status === 'done'),
      sizeBytes: job.videoSizeBytes ?? null,
      loopCheck: job.loopCheck,
    };
  }

  private writeSse(response: Response, job: JobState): void {
    response.write(`data: ${JSON.stringify(this.toPublic(job))}\n\n`);
  }

  private broadcast(job: JobState): void {
    const data = `data: ${JSON.stringify(this.toPublic(job))}\n\n`;
    for (const response of job.clients) {
      try { response.write(data); } catch { job.clients.delete(response); }
    }
  }

  private async cleanupJobFiles(job: JobState, removeRoot: boolean, preserveVideo = true): Promise<void> {
    const root = path.dirname(job.htmlPath);
    if (!preserveVideo && job.videoPath) await fs.rm(job.videoPath, { force: true });
    if (removeRoot || !preserveVideo) await fs.rm(root, { recursive: true, force: true });
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    for (const [jobId, job] of this.jobs) {
      if (!job.finishedAt || job.clients.size > 0) continue;
      if (now - job.finishedAt < this.config.jobTtlMs) continue;
      await this.cleanupJobFiles(job, true);
      this.jobs.delete(jobId);
    }
  }
}
