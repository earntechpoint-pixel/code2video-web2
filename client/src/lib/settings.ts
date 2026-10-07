import type { Quality, Settings } from '../types';

export const QUALITY_LABELS: Record<Quality, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function validateSettings(settings: Settings): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(settings.width) || settings.width < 160 || settings.width > 3840) errors.push('Width must be an integer between 160 and 3840.');
  if (!Number.isInteger(settings.height) || settings.height < 90 || settings.height > 2160) errors.push('Height must be an integer between 90 and 2160.');
  if (!Number.isInteger(settings.fps) || ![24, 30, 60].includes(settings.fps)) errors.push('FPS must be 24, 30, or 60.');
  if (!Number.isFinite(settings.duration) || settings.duration < 1 || settings.duration > 120) errors.push('Duration must be between 1 and 120 seconds.');
  if (!['low', 'medium', 'high'].includes(settings.quality)) errors.push('Quality must be low, medium, or high.');
  if (settings.width * settings.height > 3840 * 2160) errors.push('Resolution must not exceed 4K.');
  return errors;
}

export function frameCount(duration: number, fps: number): number {
  return Math.round(duration * fps);
}
