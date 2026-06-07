// slc-code — CLI coding agent platform
// Barrel export for utility modules

export { ok, err, isOk, isErr, type Result } from "./utils/result.js";
export { SlcError, toError, errorMessage, isAbortError } from "./utils/errors.js";
export { logger, setLogLevel, type LogLevel, Logger } from "./utils/logger.js";
