// AskUser Runtime — pending question queue with real answer submission
//
// Questions are queued and wait for real user input via submitAskUserAnswers().
// No placeholder answers — the promise resolves only when a real answer is submitted
// or the question is cancelled.

import type { AskUserCallback } from "../tools/builtin/ask-user.js";

// ---------------------------------------------------------------------------
// Pending question tracking
// ---------------------------------------------------------------------------

export interface PendingQuestion {
  id: string;
  questions: string[];
  resolve: (answers: string[]) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

// Module-level pending questions map
const pending = new Map<string, PendingQuestion>();
let nextId = 1;

/**
 * Create an AskUser callback that queues questions and waits for real answers.
 * The returned callback does NOT throw — it returns a promise that resolves
 * only when submitAskUserAnswers() or cancelAskUser() is called.
 */
export function createAskUserCallback(): AskUserCallback {
  return (questions: string[]): Promise<string[]> => {
    return new Promise<string[]>((resolve, reject) => {
      const id = `ask-${nextId++}`;
      pending.set(id, {
        id,
        questions,
        resolve,
        reject,
        createdAt: Date.now(),
      });
    });
  };
}

/**
 * Submit answers for a pending question.
 * Returns true if the question was found and resolved, false otherwise.
 */
export function submitAskUserAnswers(id: string, answers: string[]): boolean {
  const question = pending.get(id);
  if (!question) return false;
  pending.delete(id);
  question.resolve(answers);
  return true;
}

/**
 * Cancel a pending question — the AskUserTool will receive isError=true.
 * Returns true if the question was found and cancelled, false otherwise.
 */
export function cancelAskUser(id: string): boolean {
  const question = pending.get(id);
  if (!question) return false;
  pending.delete(id);
  question.reject(new Error("User cancelled the question"));
  return true;
}

/**
 * Get all currently pending questions.
 */
export function getPendingQuestions(): PendingQuestion[] {
  return [...pending.values()];
}

/**
 * Get a specific pending question by ID.
 */
export function getPendingQuestion(id: string): PendingQuestion | undefined {
  return pending.get(id);
}

/**
 * Clear all pending questions (for testing).
 */
export function clearPendingQuestions(): void {
  for (const q of pending.values()) {
    q.reject(new Error("Session ended"));
  }
  pending.clear();
}
