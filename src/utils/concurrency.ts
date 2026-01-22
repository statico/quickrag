export class ConcurrencyLimiter {
  private semaphore: number;
  private queue: Array<() => void> = [];
  private active: number = 0;

  constructor(maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new Error("maxConcurrent must be at least 1");
    }
    this.semaphore = maxConcurrent;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        this.active++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.active--;
          if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
          }
        }
      };

      if (this.active < this.semaphore) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }

  getActiveCount(): number {
    return this.active;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}
