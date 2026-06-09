import React from "react";
import { Box, Text } from "ink";
import type { Command } from "../../commands/registry.js";

export interface CommandPaletteProps {
  commands: Command[];
  filter: string;
  selectedIndex: number;
}

export function CommandPalette({ commands, filter, selectedIndex }: CommandPaletteProps) {
  const filtered = commands.filter(
    (cmd) => cmd.name.includes(filter) || cmd.aliases?.some((a) => a.includes(filter)),
  );

  if (filtered.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text dimColor>No matching commands</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {filtered.map((cmd, i) => {
        const isSelected = i === selectedIndex;
        const aliasStr = cmd.aliases?.length ? ` (${cmd.aliases.join(", ")})` : "";
        const usageStr = cmd.usage ? ` ${cmd.usage}` : "";
        return (
          <Box key={cmd.name}>
            <Text bold={isSelected} inverse={isSelected}>
              /{cmd.name}{aliasStr}{usageStr}  {cmd.description}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
