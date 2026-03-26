import { describe, expect, test } from "vite-plus/test";

import { buildInlineMarkdownRanges } from "./inline-markdown";

describe("buildInlineMarkdownRanges", () => {
  test("adds subscript and superscript ranges outside inline code", () => {
    const ranges = buildInlineMarkdownRanges("Water is H~2~O and X^2^.", [0, 0]);

    expect(ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subscript: true }),
        expect.objectContaining({ superscript: true }),
      ]),
    );
  });

  test("does not apply nested markdown styling inside inline code spans", () => {
    const ranges = buildInlineMarkdownRanges(
      "`^superscript^ ~subscript~ **bold** _italic_ ~~strike~~ <u>underline</u>`",
      [0, 0],
    );

    expect(ranges).toEqual([expect.objectContaining({ code: true })]);
  });
});
