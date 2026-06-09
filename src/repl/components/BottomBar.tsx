import React from "react";
import { Box, Text } from "ink";

export interface BottomBarProps {
  inputTokens: number;
  outputTokens: number;
  estimatedOutputTokens?: number;
}

export function BottomBar({ inputTokens, outputTokens, estimatedOutputTokens }: BottomBarProps) {
  const tokenDisplay =
    inputTokens > 0 || outputTokens > 0
      ? `tok:${inputTokens}+${outputTokens}`
      : estimatedOutputTokens
        ? `tok:?+~${estimatedOutputTokens}`
        : null;

  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Text dimColor>↑↓:history  Tab:complete  Ctrl+C:abort</Text>
      {tokenDisplay && (
        <>
          <Text dimColor>  </Text>
          <Text dimColor>{tokenDisplay}</Text>
        </>
      )}
    </Box>
  );
}
