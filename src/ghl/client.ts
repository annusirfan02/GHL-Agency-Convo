/**
 * Thin axios wrapper for GHL API calls.
 * Handles auth headers, versioning, and retries on 429/5xx.
 */
import axios, { AxiosInstance, AxiosError } from 'axios';

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = 'v3';

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15_000;

export function createGhlClient(accessToken: string): AxiosInstance {
  const client = axios.create({
    baseURL: GHL_BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 30_000,
  });

  return client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a GHL API call with retry logic.
 * Retries on 429 (rate limit) and 5xx (server errors).
 * Will NOT retry 4xx client errors (except 429).
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const axiosErr = err as AxiosError;

      if (axiosErr.response) {
        const status = axiosErr.response.status;

        // Do not retry 4xx client errors (except 429)
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(
            `GHL API client error ${status}: ${JSON.stringify(axiosErr.response.data)}`
          );
        }

        // For 429, respect Retry-After header if present
        if (status === 429) {
          const retryAfter = axiosErr.response.headers['retry-after'] as string | undefined;
          if (retryAfter) {
            const waitMs = parseInt(retryAfter, 10) * 1000;
            console.warn(`[RETRY] 429 rate limit — waiting ${waitMs}ms`);
            await sleep(waitMs);
            continue;
          }
        }
      }

      if (attempt <= MAX_RETRIES) {
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);
        console.warn(
          `[RETRY] Attempt ${attempt}/${MAX_RETRIES} failed — retrying in ${delay}ms. Error: ${(err as Error).message}`
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
