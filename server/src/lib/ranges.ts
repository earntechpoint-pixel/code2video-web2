export interface FrameRange {
  start: number;
  end: number;
}

export function splitFrameRanges(totalFrames: number, workerCount: number): FrameRange[] {
  if (!Number.isInteger(totalFrames) || totalFrames < 0) throw new Error('totalFrames must be a non-negative integer.');
  if (!Number.isInteger(workerCount) || workerCount < 1) throw new Error('workerCount must be a positive integer.');
  if (totalFrames === 0) return [];
  const count = Math.min(workerCount, totalFrames);
  const base = Math.floor(totalFrames / count);
  const remainder = totalFrames % count;
  const ranges: FrameRange[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i < remainder ? 1 : 0);
    ranges.push({ start: cursor, end: cursor + size });
    cursor += size;
  }
  return ranges;
}
