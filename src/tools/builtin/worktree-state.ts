// Shared worktree state — DEPRECATED
//
// Previously used a module-level singleton to track previousCwd.
// Now the previousCwd is carried through contextModifier in ToolOutput
// and applied by query.ts to toolContext, so each engine instance has
// its own isolated state.
//
// These functions are kept as no-ops for backward compatibility.

/** No-op — previousCwd is now in contextModifier. */
export function savePreviousCwd(_cwd: string): void {
  // no-op
}

/** No-op — previousCwd is now read from toolContext. */
export function getPreviousCwd(): string | undefined {
  return undefined;
}

/** No-op. */
export function clearPreviousCwd(): void {
  // no-op
}

/** No-op. */
export function resetWorktreeState(): void {
  // no-op
}
