import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { marked } from "marked";
import { highlight } from "cli-highlight";

export interface MarkdownBlockProps {
  content: string;
}

function renderInline(text: string): string {
  // Strip markdown inline formatting for terminal display
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")       // **bold** → bold
    .replace(/\*(.+?)\*/g, "$1")             // *italic* → italic
    .replace(/`(.+?)`/g, "$1")               // `code` → code
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)"); // [text](url) → text (url)
}

export function MarkdownBlock({ content }: MarkdownBlockProps) {
  const tokens = useMemo(() => {
    try {
      const lexer = new marked.Lexer();
      return lexer.lex(content);
    } catch {
      return [{ type: "paragraph", text: content, raw: content }];
    }
  }, [content]);

  return (
    <Box flexDirection="column">
      {tokens.map((token, i) => {
        if (token.type === "code") {
          const lang = (token as { lang?: string }).lang ?? "";
          const code = (token as { text: string }).text;
          let highlighted: string;
          try {
            highlighted = highlight(code, { language: lang || undefined });
          } catch {
            highlighted = code;
          }
          return (
            <Box key={i} flexDirection="column">
              {lang && <Text dimColor>```{lang}</Text>}
              <Text>{highlighted}</Text>
              <Text dimColor>```</Text>
            </Box>
          );
        }

        if (token.type === "list") {
          const listToken = token as { items: Array<{ text: string }> };
          return (
            <Box key={i} flexDirection="column">
              {listToken.items.map((item, j) => (
                <Text key={j}>  • {renderInline(item.text)}</Text>
              ))}
            </Box>
          );
        }

        if (token.type === "heading") {
          const headingToken = token as { depth: number; text: string };
          return (
            <Box key={i}>
              <Text bold>
                {"#".repeat(headingToken.depth)} {renderInline(headingToken.text)}
              </Text>
            </Box>
          );
        }

        if (token.type === "paragraph") {
          const paraToken = token as { text: string };
          return (
            <Box key={i}>
              <Text>{renderInline(paraToken.text)}</Text>
            </Box>
          );
        }

        // Fallback for unknown tokens
        const raw = (token as { raw?: string }).raw ?? "";
        if (raw) {
          return (
            <Box key={i}>
              <Text>{raw}</Text>
            </Box>
          );
        }
        return null;
      })}
    </Box>
  );
}
