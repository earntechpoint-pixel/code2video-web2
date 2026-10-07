import { promises as fs } from 'node:fs';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IEND = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

export function isValidPngBuffer(data: Buffer): boolean {
  if (data.length < SIGNATURE.length + IEND.length) return false;
  if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return false;
  const lastPossible = Math.max(0, data.length - IEND.length - 16);
  for (let i = data.length - IEND.length; i >= lastPossible; i--) {
    if (data.subarray(i, i + IEND.length).equals(IEND)) return true;
  }
  return false;
}

export async function isValidPngFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size < SIGNATURE.length + IEND.length) return false;
    const data = await fs.readFile(filePath);
    return isValidPngBuffer(data);
  } catch {
    return false;
  }
}
