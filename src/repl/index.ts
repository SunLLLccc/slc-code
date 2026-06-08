// REPL launcher — creates and renders the Ink REPL

import React from "react";
import { render } from "ink";
import { ReplApp } from "./app.js";
import type { Provider } from "../engine/providers/base.js";
import type { CommandRegistry, CommandContext } from "../commands/registry.js";

export interface ReplOptions {
  provider: Provider;
  commandRegistry: CommandRegistry;
  commandContext: CommandContext;
  model?: string;
}

/**
 * Launch the interactive REPL.
 * Returns a promise that resolves when the REPL exits.
 */
export function launchRepl(options: ReplOptions): Promise<void> {
  return new Promise((resolve) => {
    const { waitUntilExit } = render(
      React.createElement(ReplApp, {
        provider: options.provider,
        commandRegistry: options.commandRegistry,
        commandContext: options.commandContext,
        initialModel: options.model,
      }),
    );

    waitUntilExit().then(() => resolve());
  });
}
