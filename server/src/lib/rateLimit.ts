import type { NextFunction, Request, Response } from 'express';

interface Bucket { count: number; resetAt: number }

export function rateLimit(windowMs: number, max: number) {
  const buckets = new Map<string, Bucket>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  }, Math.max(windowMs, 10_000)).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Rate limit exceeded. Please try again shortly.' });
      return;
    }
    next();
  };
}
