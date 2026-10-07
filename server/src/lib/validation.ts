import type { RenderSettings } from '../types.js';

const fpsValues = new Set([24, 30, 60]);
const qualities = new Set(['low', 'medium', 'high']);
const renderModes = new Set(['server', 'canvas']);

export function validateSettings(input: unknown, maxWidth = 3840, maxHeight = 2160, maxDuration = 120): { settings?: RenderSettings; errors: string[] } {
  if (!input || typeof input !== 'object') return { errors: ['Settings must be a JSON object.'] };
  const value = input as Record<string, unknown>;
  const width = Number(value.width);
  const height = Number(value.height);
  const fps = Number(value.fps);
  const duration = Number(value.duration);
  const quality = String(value.quality);
  const renderMode = String(value.renderMode);
  const loopCheck = Boolean(value.loopCheck);
  const errors: string[] = [];

  if (!Number.isInteger(width) || width < 160 || width > maxWidth) errors.push(`Width must be an integer from 160 to ${maxWidth}.`);
  if (!Number.isInteger(height) || height < 90 || height > maxHeight) errors.push(`Height must be an integer from 90 to ${maxHeight}.`);
  if (!Number.isInteger(fps) || !fpsValues.has(fps)) errors.push('FPS must be 24, 30, or 60.');
  if (!Number.isFinite(duration) || duration < 1 || duration > maxDuration) errors.push(`Duration must be between 1 and ${maxDuration} seconds.`);
  if (!qualities.has(quality)) errors.push('Quality must be low, medium, or high.');
  if (!renderModes.has(renderMode)) errors.push('Render mode must be server or canvas.');
  if (width * height > maxWidth * maxHeight) errors.push('Resolution must not exceed the configured 4K limit.');

  if (errors.length > 0) return { errors };
  return {
    settings: {
      width,
      height,
      fps: fps as 24 | 30 | 60,
      duration,
      quality: quality as RenderSettings['quality'],
      renderMode: renderMode as RenderSettings['renderMode'],
      loopCheck,
    },
    errors: [],
  };
}

export function totalFrames(settings: RenderSettings): number {
  return Math.round(settings.duration * settings.fps);
}
