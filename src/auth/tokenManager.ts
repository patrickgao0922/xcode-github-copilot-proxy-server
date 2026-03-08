import { config } from "../config.js";
import {
  fetchCopilotToken,
  CopilotAuthError,
  type CopilotTokenResult,
} from "./githubClient.js";

const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
const FALLBACK_RETRY_MS = 60_000;

class TokenManager {
  private currentToken: string | null = null;
  private currentApiBase: string | null = null;
  private expiresAt: Date | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private startPromise: Promise<void> | null = null;

  async start(): Promise<void> {
    this.startPromise = this.fetchAndSchedule();
    await this.startPromise;
  }

  stop(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async getToken(): Promise<string> {
    // Await initial fetch if still in progress
    if (this.startPromise !== null) {
      await this.startPromise;
      this.startPromise = null;
    }

    // Force refresh if expired
    if (
      this.expiresAt !== null &&
      Date.now() >= this.expiresAt.getTime()
    ) {
      await this.fetchAndSchedule();
    }

    if (this.currentToken === null) {
      throw new Error("Copilot token not available");
    }

    return this.currentToken;
  }

  getApiBase(): string {
    return this.currentApiBase ?? "https://api.githubcopilot.com";
  }

  private async fetchAndSchedule(): Promise<void> {
    const result = await this.fetchWithRetry();
    this.currentToken = result.token;
    this.currentApiBase = result.apiBase ?? null;
    this.expiresAt = result.expiresAt;
    this.scheduleRefresh(result.expiresAt);
    console.info(
      `[tokenManager] Copilot token acquired, expires at ${result.expiresAt.toISOString()}${result.apiBase ? `, api=${result.apiBase}` : ""}`
    );
  }

  private scheduleRefresh(expiresAt: Date): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
    }

    const bufferMs =
      config.copilot.tokenRefreshBufferSecs * 1_000;
    const delayMs = Math.max(
      0,
      expiresAt.getTime() - Date.now() - bufferMs
    );

    this.refreshTimer = setTimeout(() => {
      void this.fetchAndSchedule().catch((err: unknown) => {
        console.error(
          "[tokenManager] All refresh retries failed, will retry in 60s:",
          err
        );
        // Schedule a fallback retry so we don't give up entirely
        this.refreshTimer = setTimeout(
          () => void this.fetchAndSchedule().catch(() => undefined),
          FALLBACK_RETRY_MS
        );
      });
    }, delayMs);
  }

  private async fetchWithRetry(): Promise<CopilotTokenResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await fetchCopilotToken(config.githubToken);
      } catch (err) {
        lastError = err;
        // Don't retry on auth errors — bad token won't get better
        if (err instanceof CopilotAuthError && err.statusCode === 401) {
          throw err;
        }
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) {
          console.warn(
            `[tokenManager] Token fetch attempt ${attempt + 1} failed, retrying in ${delay / 1000}s:`,
            err
          );
          await sleep(delay);
        }
      }
    }
    throw lastError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const tokenManager = new TokenManager();
