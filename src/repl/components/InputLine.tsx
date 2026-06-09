import React from "react";
import { Box, Text } from "ink";

export interface InputLineProps {
  value: string;
  isAskMode: boolean;
}

export function InputLine({ value, isAskMode }: InputLineProps) {
  return (
    <Box>
      <Text color={isAskMode ? "yellow" : "green"}>
        {isAskMode ? "❓ " : "❯ "}
      </Text>
      <Text>{value}</Text>
      <Text dimColor>█</Text>
    </Box>
  );
}
