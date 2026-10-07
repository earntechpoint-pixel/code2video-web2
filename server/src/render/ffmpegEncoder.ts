import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import type { RenderSettings } from '../types.js';

function crfFor(quality: RenderSettings['quality']): number {
  if (quality === 'high') return 14;
  if (quality === 'medium') return 16;
  return 18;
}

export async function encodeMp4(
  framesDir: string,
  outputPath: string,
  settings: RenderSettings,
  audioPath: string | undefined,
  isCancelled: () => boolean,
  onStatus: () => void,
): Promise<void> {
  const ffmpeg = ffmpegPath || 'ffmpeg';
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-framerate', String(settings.fps),
    '-start_number', '0',
    '-i', path.join(framesDir, 'f_%05d.png'),
  ];

  if (audioPath) args.push('-i', audioPath);
  args.push('-frames:v', String(Math.round(settings.duration * settings.fps)), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crfFor(settings.quality)), '-preset', 'medium', '-movflags', '+faststart');
  if (audioPath) {
    args.push('-map', '0:v:0', '-map', '1:a:0', '-af', `apad=whole_dur=${settings.duration}`, '-c:a', 'aac', '-b:a', '128k', '-t', String(settings.duration));
  } else {
    args.push('-an');
  }
  args.push('-y', outputPath);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  onStatus();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const interval = setInterval(() => {
      if (isCancelled()) child.kill('SIGTERM');
    }, 250);
    child.on('error', (error) => {
      clearInterval(interval);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearInterval(interval);
      if (isCancelled()) {
        reject(new DOMException('Encoding cancelled.', 'AbortError'));
        return;
      }
      if (code !== 0) {
        reject(new Error(`ffmpeg failed${signal ? ` (${signal})` : ''}: ${stderr.slice(0, 1500) || 'unknown error'}`));
        return;
      }
      resolve();
    });
  });
}
