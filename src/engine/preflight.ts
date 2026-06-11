// Preflight handler — deterministic local responses for greetings and model questions.
// Intercepts specific user inputs before they reach the provider, so product identity
// is never at the mercy of the underlying model's training.

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type PreflightIntent = "greeting" | "model_question" | "none";

// Exact-match greeting set (lowercase / canonical forms).
// After stripping trailing punctuation, the input must match one of these exactly.
const GREETINGS = new Set([
  // English
  "hi", "hello", "hey", "yo", "sup", "howdy", "hola",
  "good morning", "good afternoon", "good evening", "good night",
  // Chinese
  "你好", "您好", "嗨", "哈喽", "嘿", "早",
  "早上好", "下午好", "晚上好", "晚安", "早安",
  "你好呀", "你好啊",
]);

// Model-identity questions: user is asking what model powers the assistant.
// These use substring matching (presence anywhere in the input).
const MODEL_QUESTION_PATTERNS: RegExp[] = [
  /你是什么模型/,
  /你用.*模型/,
  /你(是|用)哪个模型/,
  /什么(大模型|LLM|语言模型)/,
  /what\s+model\s+(are\s+you|do\s+you\s+use)/i,
  /which\s+model/i,
  /what\s+LLM/i,
  /what\s+are\s+you\s+(powered|built)\s+(by|with|on)/i,
  /what('s|\s+is)\s+your\s+model/i,
];

/**
 * Classify user input into a preflight intent.
 *
 * - "greeting": pure greeting with no task content → return fixed product intro
 * - "model_question": asking about the underlying model → let provider handle
 * - "none": normal task → let provider handle
 */
export function classifyPreflightIntent(input: string): PreflightIntent {
  const trimmed = input.trim();

  // Empty or whitespace-only is not a greeting
  if (!trimmed) return "none";

  // Model questions take priority — they should NEVER be intercepted as greetings
  for (const pattern of MODEL_QUESTION_PATTERNS) {
    if (pattern.test(trimmed)) return "model_question";
  }

  // Strip trailing punctuation for greeting matching
  // e.g. "你好！" → "你好", "hello!" → "hello"
  const stripped = trimmed.replace(/[!?！？,，.。~～\s]+$/g, "").trim().toLowerCase();

  // Exact match: the entire input (after stripping trailing punctuation) is a greeting
  if (GREETINGS.has(stripped)) return "greeting";

  // Prefix match with guard: input starts with a greeting followed by ONLY punctuation/whitespace.
  // This catches "你好呀！" → stripped "你好呀" (exact) and "你好！" → stripped "你好" (exact).
  // But rejects "你好，帮我修一下测试" because after the greeting there's a comma + task text.
  // We only apply this for multi-char greetings (to avoid false positives on "hi").
  for (const g of GREETINGS) {
    if (g.length >= 2 && stripped.startsWith(g)) {
      const rest = stripped.slice(g.length);
      // Only match if the rest is empty or pure punctuation/whitespace
      if (rest === "" || /^[!?！？,，.。~～\s]*$/.test(rest)) {
        return "greeting";
      }
    }
  }

  return "none";
}

// ---------------------------------------------------------------------------
// Greeting responses
// ---------------------------------------------------------------------------

const ZH_GREETING =
  "我是 slc code，一个基于大语言模型的终端编程助手。" +
  "我可以帮你读写文件、执行命令、搜索代码、调试程序、分析项目结构等。" +
  "直接告诉我你想做什么，我来帮你完成。";

const EN_GREETING =
  "I am slc code, a terminal coding assistant powered by large language models. " +
  "I can help you read and edit files, run commands, search code, debug programs, " +
  "and analyze project structure. Tell me what you want to do, and I'll help you get it done.";

/**
 * Return the fixed product greeting in the appropriate language.
 * Chinese inputs get Chinese response; everything else gets English.
 */
export function getGreetingResponse(input: string): string {
  // Detect Chinese characters in the input
  const isChinese = /[一-鿿]/.test(input);
  return isChinese ? ZH_GREETING : EN_GREETING;
}
