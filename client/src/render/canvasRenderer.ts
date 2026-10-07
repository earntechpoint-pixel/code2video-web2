import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { ConsoleEntry, LoopCheckResult, Settings } from '../types';
import { frameCount } from '../lib/settings';
import { postBridgeMessage } from '../lib/bridge';

export interface CanvasRenderCallbacks {
  onProgress: (framesDone: number, totalFrames: number, startedAt: number) => void;
  isCancelled: () => boolean;
  onConsole?: (entry: ConsoleEntry) => void;
  onWarning?: (message: string) => void;
}

export interface CanvasRenderResult {
  blob: Blob;
  loopCheck: LoopCheckResult | null;
}

function bitrateFor(settings: Settings): number {
  const pixels = settings.width * settings.height;
  const base = pixels <= 1920 * 1080 ? { low: 8, medium: 14, high: 24 } : { low: 18, medium: 28, high: 50 };
  const scale = Math.min(1.5, pixels / (1920 * 1080));
  return Math.round(base[settings.quality] * 1_000_000 * Math.max(0.55, scale));
}

function codecFor(width: number, height: number, fps: number): string {
  const pixels = width * height;
  if (pixels >= 2560 * 1440) return fps >= 60 ? 'avc1.640034' : 'avc1.640033';
  if (pixels >= 1920 * 1080) return 'avc1.64002A';
  return 'avc1.640028';
}

function frameDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return 255;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

async function waitForEncoderSpace(encoder: VideoEncoder | AudioEncoder, isCancelled: () => boolean): Promise<void> {
  while (encoder.encodeQueueSize >= 10) {
    if (isCancelled()) throw new DOMException('Rendering cancelled.', 'AbortError');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function drawLetterboxed(ctx: OffscreenCanvasRenderingContext2D, bitmap: ImageBitmap, outputWidth: number, outputHeight: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outputWidth, outputHeight);
  const scale = Math.min(outputWidth / bitmap.width, outputHeight / bitmap.height);
  const drawWidth = Math.round(bitmap.width * scale);
  const drawHeight = Math.round(bitmap.height * scale);
  const x = Math.round((outputWidth - drawWidth) / 2);
  const y = Math.round((outputHeight - drawHeight) / 2);
  ctx.drawImage(bitmap, x, y, drawWidth, drawHeight);
}

async function requestFrame(
  frame: HTMLIFrameElement,
  time: number,
  timeoutMs: number,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    let timer: number | undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.__code2video !== true) return;
      if (event.data.type === 'error') {
        cleanup();
        reject(new Error(event.data.message || 'The animation reported a JavaScript error.'));
        return;
      }
      if (event.data.type === 'frame') {
        cleanup();
        const bitmap = event.data.bitmap as ImageBitmap;
        resolve({ bitmap, width: Number(event.data.width), height: Number(event.data.height) });
      }
    };
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (timer !== undefined) window.clearTimeout(timer);
    };
    window.addEventListener('message', onMessage);
    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Animation frame timed out after ${timeoutMs / 1000}s.`));
    }, timeoutMs);
    postBridgeMessage(frame, 'drawFrame', { time });
  });
}

interface DecodedAudio {
  context: AudioContext;
  buffer: AudioBuffer;
  sampleRate: number;
  channels: number;
}

async function decodeAudioFile(audioFile: File): Promise<DecodedAudio> {
  if (typeof AudioContext === 'undefined' || typeof AudioEncoder === 'undefined') {
    throw new Error('This browser cannot encode AAC audio with WebCodecs. Use Full page (server) rendering for audio.');
  }
  const context = new AudioContext({ sampleRate: 48_000 });
  try {
    const buffer = await context.decodeAudioData(await audioFile.arrayBuffer());
    const sampleRate = buffer.sampleRate;
    const channels = Math.min(2, buffer.numberOfChannels || 1);
    const config: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 128_000 };
    const supported = await AudioEncoder.isConfigSupported(config);
    if (!supported.supported) {
      await context.close().catch(() => undefined);
      throw new Error('This browser does not support AAC audio encoding for in-browser MP4 export.');
    }
    return { context, buffer, sampleRate, channels };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

async function encodeAudio(
  decoded: DecodedAudio,
  duration: number,
  muxer: Muxer<ArrayBufferTarget>,
  isCancelled: () => boolean,
): Promise<void> {
  const { buffer, sampleRate, channels } = decoded;
  const totalFrames = Math.round(duration * sampleRate);
  const config: AudioEncoderConfig = {
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: channels,
    bitrate: 128_000,
  };
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
    error: (error) => console.error(error),
  });
  encoder.configure(config);

  try {
    const chunkSize = 1024;
    for (let start = 0; start < totalFrames; start += chunkSize) {
      if (isCancelled()) throw new DOMException('Rendering cancelled.', 'AbortError');
      await waitForEncoderSpace(encoder, isCancelled);
      const count = Math.min(chunkSize, totalFrames - start);
      const data = new Float32Array(count * channels);
      for (let channel = 0; channel < channels; channel++) {
        const sourceChannel = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
        const channelOffset = channel * count;
        for (let i = 0; i < count; i++) {
          const sourceIndex = start + i;
          data[channelOffset + i] = sourceIndex < sourceChannel.length ? sourceChannel[sourceIndex] : 0;
        }
      }
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: count,
        numberOfChannels: channels,
        timestamp: Math.round((start / sampleRate) * 1e6),
        data,
      });
      encoder.encode(audioData);
      audioData.close();
    }
    await encoder.flush();
  } finally {
    encoder.close();
    await decoded.context.close().catch(() => undefined);
  }
}

export async function renderCanvasInBrowser(
  frame: HTMLIFrameElement,
  settings: Settings,
  audioFile: File | null,
  callbacks: CanvasRenderCallbacks,
): Promise<CanvasRenderResult> {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    throw new Error('WebCodecs is not supported in this browser. Use Chrome/Edge or switch to Full page (server).');
  }
  const totalFrames = frameCount(settings.duration, settings.fps);
  const codec = codecFor(settings.width, settings.height, settings.fps);
  const videoConfig: VideoEncoderConfig = {
    codec,
    width: settings.width,
    height: settings.height,
    bitrate: bitrateFor(settings),
    framerate: settings.fps,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'quality',
  };
  const supported = await VideoEncoder.isConfigSupported(videoConfig);
  if (!supported.supported) throw new Error(`H.264 WebCodecs encoding is not supported at ${settings.width}×${settings.height}. Try Full page (server).`);

  const decodedAudio = audioFile ? await decodeAudioFile(audioFile) : null;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: settings.width,
      height: settings.height,
      frameRate: settings.fps,
    },
    ...(decodedAudio ? { audio: { codec: 'aac' as const, numberOfChannels: decodedAudio.channels, sampleRate: decodedAudio.sampleRate } } : {}),
    fastStart: 'in-memory',
  });

  const output = new OffscreenCanvas(settings.width, settings.height);
  const ctx = output.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Unable to create an OffscreenCanvas 2D context.');

  let firstPixels: Uint8ClampedArray | null = null;
  let sourceDimensionsWarned = false;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
    error: (error) => console.error(error),
  });
  encoder.configure(videoConfig);

  const startedAt = performance.now();
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (callbacks.isCancelled()) throw new DOMException('Rendering cancelled.', 'AbortError');
      await waitForEncoderSpace(encoder, callbacks.isCancelled);
      const time = i / settings.fps;
      const requested = await requestFrame(frame, time, 15_000);
      try {
        if (!sourceDimensionsWarned && (requested.width !== settings.width || requested.height !== settings.height)) {
          sourceDimensionsWarned = true;
          callbacks.onWarning?.(`Source canvas is ${requested.width}×${requested.height}; export is ${settings.width}×${settings.height}. The frame is scaled with aspect-ratio-preserving black letterboxing.`);
        }
        drawLetterboxed(ctx, requested.bitmap, settings.width, settings.height);
        const previewSample = new OffscreenCanvas(160, 90);
        const sampleCtx = previewSample.getContext('2d', { willReadFrequently: true });
        if (sampleCtx && i === 0) {
          drawLetterboxed(sampleCtx, requested.bitmap, 160, 90);
          firstPixels = sampleCtx.getImageData(0, 0, 160, 90).data;
        }

        const timestamp = Math.round((i * 1e6) / settings.fps);
        const duration = Math.round(1e6 / settings.fps);
        const videoFrame = new VideoFrame(output, { timestamp, duration });
        encoder.encode(videoFrame, { keyFrame: i === 0 || i % (settings.fps * 2) === 0 });
        videoFrame.close();
      } finally {
        requested.bitmap.close();
      }
      callbacks.onProgress(i + 1, totalFrames, startedAt);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    await encoder.flush();
    encoder.close();

    if (decodedAudio) await encodeAudio(decodedAudio, settings.duration, muxer, callbacks.isCancelled);

    let loopCheck: LoopCheckResult | null = null;
    if (settings.loopCheck && firstPixels) {
      const endpoint = await requestFrame(frame, settings.duration, 15_000);
      try {
        const sample = new OffscreenCanvas(160, 90);
        const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
        if (!sampleCtx) throw new Error('Could not prepare loop-check canvas.');
        drawLetterboxed(sampleCtx, endpoint.bitmap, 160, 90);
        const endpointPixels = sampleCtx.getImageData(0, 0, 160, 90).data;
        const mad = frameDifference(firstPixels, endpointPixels);
        const threshold = 4;
        loopCheck = {
          passed: mad <= threshold,
          meanAbsoluteDifference: mad,
          threshold,
          message: mad <= threshold ? 'Seamless loop OK' : 'This animation may not loop seamlessly',
        };
      } finally {
        endpoint.bitmap.close();
      }
    }

    muxer.finalize();
    const buffer = target.buffer;
    return { blob: new Blob([buffer], { type: 'video/mp4' }), loopCheck };
  } catch (error) {
    try { encoder.close(); } catch { /* already closed */ }
    throw error;
  }
}
