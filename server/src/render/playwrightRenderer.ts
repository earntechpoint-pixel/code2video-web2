import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from 'playwright';
import type { FrameRange } from '../lib/ranges.js';
import { splitFrameRanges } from '../lib/ranges.js';
import { isValidPngFile } from '../lib/png.js';
import { comparePngBuffers } from '../lib/loopCheck.js';
import type { JobState, ServerConfig } from '../types.js';
import { totalFrames } from '../lib/validation.js';

export interface RenderCallbacks {
  isCancelled: () => boolean;
  onFramesDone: (done: number) => void;
  onStatus: (status: JobState['status']) => void;
}

export interface RenderOutput {
  framesDir: string;
  firstFrame: string;
  loopCheck: JobState['loopCheck'];
}

interface WorkerContext {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  hasDraw: boolean;
  jobRoot: string;
  virtualMs: number;
}

const VIRTUAL_CLOCK_SCRIPT = `(() => {
  const baseDate = Date.now();
  let virtualMs = 0;
  try { Object.defineProperty(Date, 'now', { configurable: true, value: () => baseDate + virtualMs }); } catch { Date.now = () => baseDate + virtualMs; }
  try { Object.defineProperty(Performance.prototype, 'now', { configurable: true, value: () => virtualMs }); } catch { /* Chromium implementation does not permit redefining it on this build. */ }
  window.__code2videoSetVirtualTime = (ms) => { virtualMs = Number(ms) || 0; };
})();`;

type ExtendedWindow = Window & { draw?: (time: number) => void; __code2videoSetVirtualTime?: (ms: number) => void };

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function createWorker(browser: Browser, htmlPath: string, jobRoot: string, width: number, height: number): Promise<WorkerContext> {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    javaScriptEnabled: true,
    bypassCSP: false,
  });
  await context.addInitScript({ content: VIRTUAL_CLOCK_SCRIPT });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('data:')) {
      await route.continue();
      return;
    }
    if (url.startsWith('file://')) {
      const filePath = decodeURIComponent(new URL(url).pathname);
      if (filePath === htmlPath || filePath.startsWith(`${jobRoot}${path.sep}`)) {
        await route.continue();
        return;
      }
    }
    await route.abort('blockedbyclient');
  });
  await page.goto(`file://${htmlPath}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const hasDraw = await page.evaluate(() => typeof (window as ExtendedWindow).draw === 'function');
  return { context, page, cdp, hasDraw, jobRoot, virtualMs: 0 };
}

async function closeWorker(worker: WorkerContext): Promise<void> {
  await worker.context.close().catch(() => undefined);
}

async function advanceVirtualTime(worker: WorkerContext, budgetMs: number): Promise<void> {
  if (budgetMs <= 0) return;
  await new Promise<void>(async (resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const onExpired = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      worker.cdp.off('Emulation.virtualTimeBudgetExpired', onExpired);
      if (timer) clearTimeout(timer);
    };
    worker.cdp.on('Emulation.virtualTimeBudgetExpired', onExpired);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Virtual-time frame advance timed out.'));
    }, 10_000);
    try {
      await worker.cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: budgetMs });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function setVirtualClock(worker: WorkerContext, ms: number): Promise<void> {
  await worker.page.evaluate((time) => {
    (window as ExtendedWindow).__code2videoSetVirtualTime?.(time);
  }, ms);
}

async function renderFrame(worker: WorkerContext, index: number, fps: number, outputPath: string, frameTimeoutMs: number): Promise<void> {
  const time = index / fps;
  await withTimeout((async () => {
    if (worker.hasDraw) {
      await setVirtualClock(worker, time * 1000);
      await worker.page.evaluate((frameTime) => {
        const draw = (window as ExtendedWindow).draw;
        if (typeof draw !== 'function') throw new Error('window.draw(t) disappeared during rendering.');
        draw(frameTime);
      }, time);
    } else {
      const desiredMs = time * 1000;
      const deltaMs = Math.max(0, desiredMs - worker.virtualMs);
      await setVirtualClock(worker, desiredMs);
      if (deltaMs > 0) await advanceVirtualTime(worker, deltaMs);
      worker.virtualMs = desiredMs;
    }
    await worker.page.screenshot({ path: outputPath, type: 'png' });
  })(), frameTimeoutMs, `Frame ${index + 1} timed out after ${frameTimeoutMs / 1000}s.`);
}

export async function renderServerFrames(
  job: JobState,
  config: ServerConfig,
  callbacks: RenderCallbacks,
): Promise<RenderOutput> {
  const framesDir = path.join(path.dirname(job.htmlPath), 'frames');
  await fs.mkdir(framesDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });

  callbacks.onStatus('rendering');
  const total = totalFrames(job.settings);
  let completed = 0;
  const ranges = splitFrameRanges(total, config.workerCount);

  try {
    await Promise.all(ranges.map(async (range: FrameRange) => {
      if (callbacks.isCancelled()) return;
      const worker = await createWorker(browser, job.htmlPath, path.dirname(job.htmlPath), job.settings.width, job.settings.height);
      try {
        for (let i = range.start; i < range.end; i++) {
          if (callbacks.isCancelled()) return;
          const framePath = path.join(framesDir, `f_${String(i).padStart(5, '0')}.png`);
          if (!await isValidPngFile(framePath)) {
            await renderFrame(worker, i, job.settings.fps, framePath, config.frameTimeoutMs);
          }
          completed += 1;
          callbacks.onFramesDone(completed);
        }
      } finally {
        await closeWorker(worker);
      }
    }));
  } finally {
    await browser.close().catch(() => undefined);
  }

  if (callbacks.isCancelled()) throw new DOMException('Rendering cancelled.', 'AbortError');
  const firstFrame = path.join(framesDir, 'f_00000.png');
  if (!await isValidPngFile(firstFrame)) throw new Error('Rendering finished without a valid first PNG frame.');

  let loopCheck: JobState['loopCheck'] = null;
  if (job.settings.loopCheck) {
    const endFrame = await renderSingleServerFrame(job.htmlPath, job.settings.width, job.settings.height, job.settings.fps, job.settings.duration, config.frameTimeoutMs);
    const firstBuffer = await fs.readFile(firstFrame);
    loopCheck = await comparePngBuffers(firstBuffer, endFrame);
  }

  return { framesDir, firstFrame, loopCheck };
}

export async function renderSingleServerFrame(
  htmlPath: string,
  width: number,
  height: number,
  fps: number,
  time: number,
  frameTimeoutMs: number,
): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const worker = await createWorker(browser, htmlPath, path.dirname(htmlPath), width, height);
  const outputPath = path.join(path.dirname(htmlPath), `single-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  try {
    await withTimeout((async () => {
      if (worker.hasDraw) {
        await setVirtualClock(worker, time * 1000);
        await worker.page.evaluate((frameTime) => {
          const draw = (window as ExtendedWindow).draw;
          if (typeof draw !== 'function') throw new Error('window.draw(t) is not available.');
          draw(frameTime);
        }, time);
      } else {
        const desiredMs = Math.max(0, time * 1000);
        await setVirtualClock(worker, desiredMs);
        await advanceVirtualTime(worker, desiredMs);
        worker.virtualMs = desiredMs;
      }
      await worker.page.screenshot({ path: outputPath, type: 'png' });
    })(), frameTimeoutMs, `Frame render timed out after ${frameTimeoutMs / 1000}s.`);
    return await fs.readFile(outputPath);
  } finally {
    await closeWorker(worker);
    await browser.close().catch(() => undefined);
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}
