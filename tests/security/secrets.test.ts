import { describe, it, expect } from "vitest";
import { scanAndRedact } from "../../src/security/secrets.js";

describe("scanAndRedact", () => {
  it("returns clean text unchanged when no secrets present", () => {
    const input = "Hello, this is normal text with no secrets.";
    const result = scanAndRedact(input);
    expect(result.cleanText).toBe(input);
    expect(result.matches).toEqual([]);
  });

  it("redacts OpenAI API keys", () => {
    const key = "sk-" + "a".repeat(30);
    const input = `Here is a key: ${key}`;
    const result = scanAndRedact(input);
    expect(result.cleanText).not.toContain(key);
    expect(result.cleanText).toContain("[REDACTED:openai_key]");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].rule).toBe("openai_key");
  });

  it("redacts Anthropic API keys", () => {
    const key = "sk-ant-" + "b".repeat(30);
    const input = `My key is ${key}`;
    const result = scanAndRedact(input);
    expect(result.cleanText).not.toContain(key);
    expect(result.cleanText).toContain("[REDACTED:anthropic_key]");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].rule).toBe("anthropic_key");
  });

  it("redacts GitHub tokens", () => {
    const token = "ghp_" + "c".repeat(30);
    const input = `Token: ${token}`;
    const result = scanAndRedact(input);
    expect(result.cleanText).not.toContain(token);
    expect(result.cleanText).toContain("[REDACTED:github_token]");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].rule).toBe("github_token");
  });

  it("redacts GitHub OAuth tokens (gho_)", () => {
    const token = "gho_" + "d".repeat(30);
    const input = `OAuth: ${token}`;
    const result = scanAndRedact(input);
    expect(result.cleanText).not.toContain(token);
    expect(result.cleanText).toContain("[REDACTED:github_token]");
    expect(result.matches).toHaveLength(1);
  });

  it("redacts AWS access keys", () => {
    const key = "AKIA" + "E".repeat(16);
    const input = `AWS key: ${key}`;
    const result = scanAndRedact(input);
    expect(result.cleanText).not.toContain(key);
    expect(result.cleanText).toContain("[REDACTED:aws_key]");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].rule).toBe("aws_key");
  });

  it("redacts multiple secrets in one text", () => {
    const openaiKey = "sk-" + "a".repeat(30);
    const awsKey = "AKIA" + "B".repeat(16);
    const input = `OpenAI: ${openaiKey}\nAWS: ${awsKey}`;
    const result = scanAndRedact(input);
    expect(result.cleanText).not.toContain(openaiKey);
    expect(result.cleanText).not.toContain(awsKey);
    expect(result.cleanText).toContain("[REDACTED:openai_key]");
    expect(result.cleanText).toContain("[REDACTED:aws_key]");
    expect(result.matches).toHaveLength(2);
  });

  it("never returns the full secret in matches", () => {
    const key = "sk-" + "x".repeat(40);
    const input = `secret: ${key}`;
    const result = scanAndRedact(input);
    for (const match of result.matches) {
      expect(match.redacted).not.toContain(key);
      // redacted field is the replacement string, not the original
      expect(match.redacted).toMatch(/^\[REDACTED:/);
    }
    // The SecretMatch type doesn't store the original value
    // startIndex and endIndex are just positions, not the secret itself
  });

  it("reports correct start and end indices", () => {
    const key = "sk-" + "z".repeat(25);
    const prefix = "prefix ";
    const input = prefix + key;
    const result = scanAndRedact(input);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].startIndex).toBe(prefix.length);
    expect(result.matches[0].endIndex).toBe(prefix.length + key.length);
  });
});
