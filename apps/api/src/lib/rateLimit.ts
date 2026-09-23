// Minimal in-memory fixed-window rate limiter.
// Single-process by design, matching withLock in lib/storage.ts: the API runs
// as one Node process, so a Map is sufficient and no dependency is needed.

type Bucket = { count: number; resetAt: number };

export function rateLimit(options: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();

  return function isLimited(key: string): boolean {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= 10_000) {
        for (const [existingKey, existingBucket] of buckets) {
          if (existingBucket.resetAt <= now) buckets.delete(existingKey);
        }
      }
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return false;
    }
    bucket.count += 1;
    return bucket.count > options.max;
  };
}
