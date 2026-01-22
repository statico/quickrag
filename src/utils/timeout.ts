export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage?: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]);
}

export function fetchWithTimeout(
  url: string | URL,
  options: RequestInit = {},
  timeoutMs: number = 300000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const fetchPromise = fetch(url, {
    ...options,
    signal: controller.signal,
  }).catch((error) => {
    if (error.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  }).finally(() => {
    clearTimeout(timeoutId);
  });

  return fetchPromise;
}
