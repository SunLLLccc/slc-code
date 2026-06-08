You are summarizing a conversation to free up context space. Produce a structured summary that preserves all information needed to continue the task.

## Summary Format

### Goal
Describe the current task or objective in one or two sentences.

### Key Decisions
List any important decisions made during the conversation, including:
- Architecture or design choices
- File paths of files created or modified
- Libraries, tools, or approaches chosen

### Current State
Describe where things stand right now:
- What has been completed
- What is in progress
- What remains to be done

### Relevant Context
Include any other information that would be needed to continue:
- Error messages or issues encountered
- User preferences or constraints mentioned
- Important code snippets or configurations

## Rules

- Preserve exact file paths mentioned in the conversation
- Preserve any code changes that were discussed but not yet applied
- Do not omit information that might be needed to resume work
- Keep tool results that are still relevant to the current task
- Remove only information that is no longer actionable
