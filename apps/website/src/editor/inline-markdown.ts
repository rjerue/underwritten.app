import type { Path, Range } from "slate";

function normalizeExternalUrl(value: string) {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
}

export function buildInlineMarkdownRanges(text: string, path: Path) {
  const ranges: Range[] = [];
  const codeRanges: Array<{ start: number; end: number }> = [];

  const overlapsCodeRange = (start: number, end: number) =>
    codeRanges.some((codeRange) => start < codeRange.end && end > codeRange.start);

  const pushRange = <T extends object>(start: number, end: number, attributes: T) => {
    ranges.push({
      anchor: { path, offset: start },
      focus: { path, offset: end },
      ...attributes,
    } as Range & T);
  };

  const pushInlineRange = <T extends object>(start: number, end: number, attributes: T) => {
    if (overlapsCodeRange(start, end)) {
      return;
    }

    pushRange(start, end, attributes);
  };

  const codeRegex = /`([^`]+?)`/g;
  let match: RegExpExecArray | null;
  while ((match = codeRegex.exec(text)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    codeRanges.push({ end, start });
    pushRange(start, end, { code: true });
  }

  const boldRegex = /\*\*(.*?)\*\*/g;
  while ((match = boldRegex.exec(text)) !== null) {
    pushInlineRange(match.index, match.index + match[0].length, { bold: true });
  }

  const italicRegex = /(?<!\*)\*([^*]+?)\*(?!\*)|_([^_]+?)_/g;
  while ((match = italicRegex.exec(text)) !== null) {
    pushInlineRange(match.index, match.index + match[0].length, { italic: true });
  }

  const strikeRegex = /~~(.*?)~~/g;
  while ((match = strikeRegex.exec(text)) !== null) {
    pushInlineRange(match.index, match.index + match[0].length, { strikethrough: true });
  }

  const subscriptRegex = /(?<!~)~([^~\n]+?)~(?!~)/g;
  while ((match = subscriptRegex.exec(text)) !== null) {
    pushInlineRange(match.index, match.index + match[0].length, { subscript: true });
  }

  const superscriptRegex = /\^([^^\n]+?)\^/g;
  while ((match = superscriptRegex.exec(text)) !== null) {
    pushInlineRange(match.index, match.index + match[0].length, { superscript: true });
  }

  const underlineRegex = /<u>(.*?)<\/u>/g;
  while ((match = underlineRegex.exec(text)) !== null) {
    pushInlineRange(match.index, match.index + match[0].length, { underline: true });
  }

  const headerRegex = /^(#{1,6})\s+(.*)$/gm;
  while ((match = headerRegex.exec(text)) !== null) {
    pushRange(match.index, match.index + match[0].length, {
      header: true,
      headerLevel: match[1]?.length ?? 1,
    });
  }

  const quoteRegex = /^>\s+(.*)$/gm;
  while ((match = quoteRegex.exec(text)) !== null) {
    pushRange(match.index, match.index + match[0].length, { blockquote: true });
  }

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = linkRegex.exec(text)) !== null) {
    if (text[match.index - 1] === "!") {
      continue;
    }

    const normalizedUrl = normalizeExternalUrl(match[2] ?? "");
    if (!normalizedUrl) {
      continue;
    }

    const label = match[1] ?? "";
    const labelStartOffset = match.index + 1;
    const labelEndOffset = labelStartOffset + label.length;
    const fullMatchEndOffset = match.index + match[0].length;

    pushRange(match.index, labelStartOffset, { hiddenMarkdown: true });
    pushRange(labelStartOffset, labelEndOffset, {
      linkLabel: label,
      linkPreview: true,
      linkUrl: normalizedUrl,
      previewEndOffset: fullMatchEndOffset,
      previewPath: path,
      previewStartOffset: match.index,
    });
    pushRange(labelEndOffset, fullMatchEndOffset, { hiddenMarkdown: true });
  }

  return ranges;
}
