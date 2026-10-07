import path from 'node:path';

export function safeFileName(input: string, fallback = 'upload.html'): string {
  const base = path.basename(input).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || fallback;
}

export function isInside(parent: string, candidate: string): boolean {
  const resolvedParent = path.resolve(parent) + path.sep;
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === path.resolve(parent) || resolvedCandidate.startsWith(resolvedParent);
}
