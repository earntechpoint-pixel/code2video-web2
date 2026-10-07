import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { JobManager } from './jobManager.js';
import { loadConfig } from './lib/config.js';
import { rateLimit } from './lib/rateLimit.js';
import { safeFileName } from './lib/pathSecurity.js';
import { validateSettings } from './lib/validation.js';
import { renderSingleServerFrame } from './render/playwrightRenderer.js';

const config = loadConfig();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});
const server = http.createServer(app);
const jobs = new JobManager(config);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(pinoHttp({ logger }));
app.use(cors({ origin: config.clientOrigin === '*' ? true : config.clientOrigin, methods: ['GET', 'POST', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: `${config.maxUploadBytes}b` }));
const apiRateLimit = rateLimit(config.rateLimitWindowMs, config.rateLimitMax);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, fieldSize: config.maxUploadBytes, files: 2, fields: 10 },
});

function isAllowedAudioName(name: string): boolean {
  return /\.(mp3|wav|m4a)$/i.test(name);
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/jobs', apiRateLimit, upload.fields([{ name: 'htmlFile', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), async (req, res, next) => {
  try {
    const fields = req.files as Record<string, Express.Multer.File[]> | undefined;
    const htmlFile = fields?.htmlFile?.[0];
    const audio = fields?.audio?.[0];
    const htmlText = typeof req.body.htmlText === 'string' ? req.body.htmlText : '';
    const settingsText = typeof req.body.settings === 'string' ? req.body.settings : '';

    if (!htmlFile && !htmlText.trim()) return res.status(400).json({ error: 'Provide HTML text or an .html file.' });
    if (htmlFile && !htmlFile.originalname.toLowerCase().endsWith('.html')) return res.status(400).json({ error: 'Only .html files are supported.' });
    if (audio && !isAllowedAudioName(audio.originalname)) return res.status(400).json({ error: 'Audio must be an MP3, WAV, or M4A file.' });

    let settingsInput: unknown;
    try { settingsInput = JSON.parse(settingsText); } catch { return res.status(400).json({ error: 'Settings must be valid JSON.' }); }
    const validation = validateSettings(settingsInput, config.maxWidth, config.maxHeight, config.maxDuration);
    if (validation.errors.length) return res.status(400).json({ error: validation.errors.join(' ') });

    const html = htmlFile ? htmlFile.buffer.toString('utf8') : htmlText;
    if (Buffer.byteLength(html, 'utf8') > config.maxUploadBytes) return res.status(413).json({ error: 'HTML upload is larger than the 5 MB limit.' });

    const job = await jobs.createJob(html, validation.settings!, audio?.buffer, safeFileName(htmlFile?.originalname || 'animation.html'));
    res.status(202).json({ jobId: job.jobId });
  } catch (error) {
    next(error);
  }
});

app.post('/api/frame', apiRateLimit, upload.fields([{ name: 'htmlFile', maxCount: 1 }]), async (req, res, next) => {
  try {
    const fields = req.files as Record<string, Express.Multer.File[]> | undefined;
    const htmlFile = fields?.htmlFile?.[0];
    const htmlText = typeof req.body.htmlText === 'string' ? req.body.htmlText : '';
    if (!htmlFile && !htmlText.trim()) return res.status(400).json({ error: 'Provide HTML text or an .html file.' });
    if (htmlFile && !htmlFile.originalname.toLowerCase().endsWith('.html')) return res.status(400).json({ error: 'Only .html files are supported.' });
    let settingsInput: unknown;
    try { settingsInput = JSON.parse(typeof req.body.settings === 'string' ? req.body.settings : ''); } catch { return res.status(400).json({ error: 'Settings must be valid JSON.' }); }
    const validation = validateSettings(settingsInput, config.maxWidth, config.maxHeight, config.maxDuration);
    if (validation.errors.length) return res.status(400).json({ error: validation.errors.join(' ') });
    const time = Number(req.body.time);
    if (!Number.isFinite(time) || time < 0 || time > validation.settings!.duration) return res.status(400).json({ error: 'Frame time is outside the animation duration.' });

    const root = await fs.mkdtemp(path.join(config.tmpRoot, 'frame-'));
    const htmlPath = path.join(root, 'animation.html');
    await fs.writeFile(htmlPath, htmlFile ? htmlFile.buffer : htmlText, htmlFile ? undefined : 'utf8');
    try {
      const png = await renderSingleServerFrame(htmlPath, validation.settings!.width, validation.settings!.height, validation.settings!.fps, time, config.frameTimeoutMs);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.send(png);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  return res.json({
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
  });
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  jobs.subscribe(req.params.id, res);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
  heartbeat.unref();
  req.on('close', () => {
    clearInterval(heartbeat);
    jobs.unsubscribe(req.params.id, res);
  });
  return undefined;
});

app.get('/api/jobs/:id/video', async (req, res, next) => {
  try {
    const job = jobs.get(req.params.id);
    if (!job?.videoPath || job.status !== 'done') return res.status(404).json({ error: 'Video is not ready.' });
    const stat = await fs.stat(job.videoPath);
    const range = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', req.query.download === '1' ? 'attachment; filename="code2video.mp4"' : 'inline; filename="code2video.mp4"');
    if (!range) {
      res.setHeader('Content-Length', String(stat.size));
      const stream = (await import('node:fs')).createReadStream(job.videoPath);
      stream.pipe(res);
      return;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= stat.size) return res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    const boundedEnd = Math.min(end, stat.size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${boundedEnd}/${stat.size}`);
    res.setHeader('Content-Length', String(boundedEnd - start + 1));
    const stream = (await import('node:fs')).createReadStream(job.videoPath, { start, end: boundedEnd });
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/jobs/:id', apiRateLimit, (req, res) => {
  const ok = jobs.cancel(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Job not found.' });
  return res.status(202).json({ cancelled: true });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: error }, 'Request failed');
  const rawMessage = error instanceof Error ? error.message : 'Unexpected server error.';
  const message = sanitizeServerError(rawMessage);
  if (rawMessage.toLowerCase().includes('file too large')) return res.status(413).json({ error: 'Upload exceeds the 5 MB limit.' });
  return res.status(500).json({ error: message });
});

function sanitizeServerError(message: string): string {
  return message
    .replaceAll(config.tmpRoot, '[job-data]')
    .replaceAll(process.cwd(), '[server]')
    .slice(0, 1500);
}

await fs.mkdir(config.tmpRoot, { recursive: true });
server.listen(config.port, config.host, () => logger.info({ port: config.port, host: config.host }, 'Code2Video Web server started'));

const shutdown = async () => {
  await jobs.shutdown();
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
