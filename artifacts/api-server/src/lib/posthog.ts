import { PostHog } from "posthog-node";
import { logger } from "./logger";

const key = process.env["EXPO_PUBLIC_POSTHOG_KEY"];
const host = process.env["EXPO_PUBLIC_POSTHOG_HOST"] || "https://us.i.posthog.com";

let _client: PostHog | null = null;

export function getPostHogClient(): PostHog | null {
  if (!key) return null;
  if (!_client) {
    _client = new PostHog(key, { host });
    logger.info({ host }, "PostHog analytics initialised");
  }
  return _client;
}

export function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  const client = getPostHogClient();
  if (!client) return;
  try {
    client.capture({ distinctId, event, properties });
  } catch {}
}

export async function shutdownPostHog(): Promise<void> {
  if (_client) {
    await _client.shutdown();
    _client = null;
  }
}
