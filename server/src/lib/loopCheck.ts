import sharp from 'sharp';
import type { LoopCheckResult } from '../types.js';

const threshold = 4;

export async function comparePngBuffers(first: Buffer, last: Buffer): Promise<LoopCheckResult> {
  const [a, b] = await Promise.all([
    sharp(first).resize(160, 90, { fit: 'fill' }).removeAlpha().raw().toBuffer(),
    sharp(last).resize(160, 90, { fit: 'fill' }).removeAlpha().raw().toBuffer(),
  ]);
  if (a.length !== b.length) {
    return { passed: false, meanAbsoluteDifference: 255, threshold, message: 'This animation may not loop seamlessly' };
  }
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i]);
  const meanAbsoluteDifference = difference / a.length;
  const passed = meanAbsoluteDifference <= threshold;
  return {
    passed,
    meanAbsoluteDifference,
    threshold,
    message: passed ? 'Seamless loop OK' : 'This animation may not loop seamlessly',
  };
}
