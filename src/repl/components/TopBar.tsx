import React from "react";
import { Box, Text } from "ink";

export interface TopBarProps {
  model: string;
  sessionId: string | null;
}

export function TopBar({ model, sessionId }: TopBarProps) {
  const shortId = sessionId ? sessionId.slice(0, 8) : "no-session";

  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderBottom={true}
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Text bold>slc-code</Text>
      <Text dimColor> │ </Text>
      <Text>{model}</Text>
      <Text dimColor> │ </Text>
      <Text dimColor>session: {shortId}</Text>
    </Box>
  );
}
