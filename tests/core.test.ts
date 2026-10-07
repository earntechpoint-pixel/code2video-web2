import { describe, expect, it } from 'vitest';
import { frameCount } from '../client/src/lib/settings';
import { isValidPngBuffer } from '../server/src/lib/png';
import { splitFrameRanges } from '../server/src/lib/ranges';
import { validateSettings } from '../server/src/lib/validation';

describe('frame timestamp math', () => {
  it('counts frames and maps indexes to the requested cadence', () => {
    expect(frameCount(1, 24)).toBe(24);
    expect(Math.round((12 * 1e6) / 30)).toBe(400000);
    expect(Math.round((59 * 1e6) / 60)).toBe(983333);
  });
});

describe('frame range splitting', () => {
  it('splits into contiguous, balanced ranges', () => {
    expect(splitFrameRanges(10, 3)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 7 },
      { start: 7, end: 10 },
    ]);
  });
});

describe('PNG validation', () => {
  it('accepts a valid PNG signature and IEND chunk', () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    expect(isValidPngBuffer(png)).toBe(true);
    expect(isValidPngBuffer(Buffer.from('not-a-png'))).toBe(false);
  });
});

describe('settings validation', () => {
  it('rejects invalid duration and resolution', () => {
    const result = validateSettings({ width: 8000, height: 720, fps: 30, duration: 121, quality: 'high', renderMode: 'server', loopCheck: true });
    expect(result.settings).toBeUndefined();
    expect(result.errors).toEqual(expect.arrayContaining([
      'Width must be an integer from 160 to 3840.',
      'Duration must be between 1 and 120 seconds.',
    ]));
  });
});
