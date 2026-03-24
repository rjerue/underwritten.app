import { describe, expect, test, vi, beforeEach, afterEach } from "vite-plus/test";
import { main } from "./cli.js";

describe("underwritten cli", () => {
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const _exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("prints help message by default", async () => {
    await main([]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Commands:"));
  });

  test("prints docs/man page", async () => {
    await main(["docs"]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Underwritten Agent Manual"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("COMMANDS"));
  });

  test("handles unknown commands", async () => {
    await expect(main(["unknown-cmd"])).rejects.toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown command: unknown-cmd"));
  });

  test("workspace status command calls the bridge", async () => {
    // Mock probeBridge to return a running bridge
    // Since probeBridge is in bridge-process.ts, we might need to mock that module
    // or just rely on the fact that ensureBridge will be called.

    // For simplicity, let's just mock the global fetch and see if it's called with /cli/execute
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ activeFilePath: "test.md", storageMode: "origin-private" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // We also need to mock ensureBridge or probeBridge because it will try to hit localhost
    // Let's mock the whole bridge-process module if possible, or just the fetch calls it makes.

    // Mocking the health check fetch that probeBridge makes
    mockFetch.mockResolvedValueOnce({ ok: true }); // probeBridge
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ activeFilePath: "test.md", storageMode: "origin-private" }),
    }); // executeCommand

    await main(["workspace", "status"]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/cli/execute"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "get_workspace_status", args: {} }),
      }),
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("test.md"));
  });

  test("document get command supports --outline", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    mockFetch.mockResolvedValueOnce({ ok: true }); // probeBridge
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ markdown: "# Title", outline: [] }),
    }); // executeCommand

    await main(["document", "get", "--outline"]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/cli/execute"),
      expect.objectContaining({
        body: JSON.stringify({ name: "get_current_document", args: { includeOutline: true } }),
      }),
    );
  });

  test("files list command passes arguments correctly", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    mockFetch.mockResolvedValueOnce({ ok: true }); // probeBridge
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    }); // executeCommand

    await main(["files", "list", "notes", "--recursive", "--dirs"]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/cli/execute"),
      expect.objectContaining({
        body: JSON.stringify({
          name: "list_files",
          args: {
            path: "notes",
            recursive: true,
            includeDirectories: true,
          },
        }),
      }),
    );
  });
});
