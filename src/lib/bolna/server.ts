import "server-only";
import { callingScope, env } from "../env";
import { type BolnaClient, createBolnaClient } from "./client";
import type { DialerConfig } from "./dialer";

/** The app's Bolna client, configured from the environment; null when no API key is set. */
export function bolnaFromEnv(): BolnaClient | null {
  const config = env();
  if (!config.BOLNA_API_KEY) return null;
  return createBolnaClient({
    apiKey: config.BOLNA_API_KEY,
    callingEnabled: config.CALLING_ENABLED,
    scope: callingScope(),
  });
}

/** The dialer's settings. There are no ops accounts, so calls are attributed to "ops" as a whole. */
export function dialerConfigFromEnv(): DialerConfig {
  const config = env();
  return {
    callingEnabled: config.CALLING_ENABLED,
    scope: callingScope(),
    capUsd: config.BOLNA_DAILY_SPEND_CAP_USD,
    actor: "ops",
  };
}
