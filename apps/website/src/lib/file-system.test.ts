import { describe, expect, test } from "vite-plus/test";

import { decodeTextFileContent } from "./file-system";

describe("file system text decoding", () => {
  test("decodes JSON text content", () => {
    const content = new TextEncoder().encode('{"name":"underwritten","enabled":true}\n');

    expect(decodeTextFileContent(content, "config.json")).toBe(
      '{"name":"underwritten","enabled":true}\n',
    );
  });

  test("rejects binary content before it can be opened as text", () => {
    const content = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]);

    expect(() => decodeTextFileContent(content, "image.png")).toThrow(
      "Cannot open image.png because it appears to be a binary file.",
    );
  });

  test("rejects invalid utf-8 content", () => {
    const content = new Uint8Array([0xc3, 0x28]);

    expect(() => decodeTextFileContent(content, "broken.bin")).toThrow(
      "Cannot open broken.bin because it appears to be a binary file.",
    );
  });
});
