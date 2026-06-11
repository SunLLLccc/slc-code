import React from "react";
import { Box, Text, useStdout } from "ink";
import { STARTUP_LOGO, STARTUP_LOGO_WIDTH, type LogoRun } from "../startup-logo.js";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

export interface StartupPanelProps {
  /** App version string, e.g. "0.1.0" */
  version: string;
  /** Current model name */
  model: string;
  /** Current working directory */
  cwd: string;
}

export type LayoutMode = "sideBySide" | "stacked" | "compact";

/**
 * Determine layout mode based on terminal width.
 * Exported for testing.
 */
export function getLayoutMode(columns: number): LayoutMode {
  if (columns >= 100) return "sideBySide";
  if (columns >= 60) return "stacked";
  return "compact";
}

/**
 * Shorten cwd for display: replace $HOME with ~, truncate if still long.
 */
function shortenCwd(cwd: string): string {
  const home = process.env.HOME;
  let display = cwd;
  if (home && cwd.startsWith(home)) {
    display = "~" + cwd.slice(home.length);
  }
  if (display.length > 45) {
    display = "..." + display.slice(display.length - 42);
  }
  return display;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LogoBlock(): React.ReactElement {
  return (
    <Box flexDirection="column">
      {STARTUP_LOGO.map((line, i) => (
        <Box key={i}>
          {line.map((run: LogoRun, j: number) => (
            <Text key={j} color={run.fg} backgroundColor={run.bg}>
              {run.text}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}

function InfoPanel({
  model,
  cwd,
}: {
  model: string;
  cwd: string;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color="green">
        Tips for getting started
      </Text>
      <Text dimColor>  Press / to use commands.</Text>
      <Text dimColor>  Press @ to mention files.</Text>
      <Text dimColor>  Press Esc twice to reset the input box.</Text>
      <Text> </Text>
      <Text> </Text>
      <Text bold color="green">
        Recent activity
      </Text>
      <Text dimColor>  No recent activity</Text>
      <Text> </Text>
      <Text> </Text>
      <Text bold color="green">
        Runtime
      </Text>
      <Text>
        {"  "}
        Model: {model}
      </Text>
      <Text dimColor>
        {"  "}
        CWD: {shortenCwd(cwd)}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StartupPanel({
  version,
  model,
  cwd,
}: StartupPanelProps): React.ReactElement {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const mode = getLayoutMode(columns);

  if (mode === "compact") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">
          slc code v{version}
        </Text>
        <Text dimColor>
          Model: {model} | {shortenCwd(cwd)}
        </Text>
      </Box>
    );
  }

  // sideBySide or stacked — both have border + logo
  const inner =
    mode === "sideBySide" ? (
      <Box flexDirection="row">
        <Box
          flexDirection="column"
          width={STARTUP_LOGO_WIDTH + 2}
        >
          <LogoBlock />
        </Box>
        <Box flexDirection="column" paddingLeft={2}>
          <InfoPanel model={model} cwd={cwd} />
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column">
        <LogoBlock />
        <Text> </Text>
        <InfoPanel model={model} cwd={cwd} />
      </Box>
    );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold color="cyan">
        slc code v{version}
      </Text>
      <Text> </Text>
      {inner}
    </Box>
  );
}
