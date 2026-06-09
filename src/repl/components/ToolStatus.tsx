import React from "react";
import { Box, Text } from "ink";
import type { ToolCallStatus } from "../output-types.js";

export interface ToolStatusLineProps {
  status: ToolCallStatus;
}

export function ToolStatusLine({ status }: ToolStatusLineProps) {
  const { name, params, state, result } = status;
  const icon = state === "pending" ? "●" : state === "success" ? "✓" : "✗";
  const color = state === "pending" ? "yellow" : state === "success" ? "green" : "red";
  const dim = state === "pending";
  const summary = params ? `: ${params}` : "";
  const resultSuffix = result ? ` (${result})` : "";

  return (
    <Box>
      <Text color={color} dimColor={dim}>
        {icon} {name}{summary}{resultSuffix}
      </Text>
    </Box>
  );
}
