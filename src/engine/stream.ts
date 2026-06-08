// Stream utility helpers

import type { StreamEvent, ProviderCapabilities } from "./types.js";
import { filterEventForCapabilities } from "./providers/capabilities.js";

/**
 * Apply capability filtering to an async generator of stream events.
 * Events that are not supported by the provider are silently dropped.
 */
export async function* filterStreamByCapabilities(
  events: AsyncGenerator<StreamEvent>,
  capabilities: ProviderCapabilities,
): AsyncGenerator<StreamEvent> {
  for await (const event of events) {
    const filtered = filterEventForCapabilities(event, capabilities);
    if (filtered !== null) {
      yield filtered;
    }
  }
}
