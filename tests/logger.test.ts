import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger, logger, setLogLevel } from "../src/utils/logger.js";

describe("logger", () => {
  let instance: Logger;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    instance = new Logger();
    // Override test-environment silence so we can capture output in these tests
    instance.setSilent(false);
    instance.setLogLevel("debug");

    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("logs debug messages to stdout", () => {
    instance.debug("debug message");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain("[debug]");
    expect(output).toContain("debug message");
  });

  it("logs info messages to stdout", () => {
    instance.info("info message");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain("[info]");
    expect(output).toContain("info message");
  });

  it("logs warn messages to stderr", () => {
    instance.warn("warn message");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[warn]");
    expect(output).toContain("warn message");
  });

  it("logs error messages to stderr", () => {
    instance.error("error message");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[error]");
    expect(output).toContain("error message");
  });

  it("respects log level filtering", () => {
    instance.setLogLevel("warn");
    instance.debug("nope");
    instance.info("nope");
    instance.warn("yes");
    instance.error("yes");

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("formats messages with timestamp", () => {
    instance.info("test");
    const output = stdoutSpy.mock.calls[0][0] as string;
    // Timestamp format: YYYY-MM-DDTHH:MM:SS.sssZ
    expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  describe("silent mode", () => {
    it("produces no output when silent", () => {
      instance.setSilent(true);
      instance.debug("nope");
      instance.info("nope");
      instance.warn("nope");
      instance.error("nope");

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe("singleton", () => {
    it("exports a logger singleton", () => {
      expect(logger).toBeDefined();
    });

    it("setLogLevel delegates to singleton", () => {
      const spy = vi.spyOn(logger, "setLogLevel");
      setLogLevel("error");
      expect(spy).toHaveBeenCalledWith("error");
      spy.mockRestore();
    });
  });

  describe("default test environment behavior", () => {
    it("new Logger instances are silent by default in test env", () => {
      const testLogger = new Logger();
      testLogger.info("should be silent");
      testLogger.error("should be silent");
      // P0 验收：测试环境不污染 stdout/stderr
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });
});
