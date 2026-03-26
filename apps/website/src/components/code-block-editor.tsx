import type { ReactNode, UIEvent } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import katex from "katex";

import { buildPlantUmlUrl, preparePlantUmlSource } from "../lib/plantuml";

import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";

export type CodeBlockNavigationApi = {
  focusEnd: () => void;
  focusStart: () => void;
};

type CodeBlockEditorProps = {
  code: string;
  language: string | null;
  onChange?: (value: string) => void;
  onDelete?: () => void;
  onExitAfterEnd?: () => void;
  onExitLeftFromStart?: () => void;
  onFocusCodeBlock?: () => void;
  onLanguageChange?: (language: string | null) => void;
  onRegisterNavigation?: (navigation: CodeBlockNavigationApi | null) => void;
  readOnly?: boolean;
};

type LanguageOption = {
  aliases: string[];
  id: string;
  label: string;
};

type HighlightToken = {
  className?: string;
  value: string;
};

type CodeBlockPanel = "code" | "preview";

const languageOptions: LanguageOption[] = [
  { aliases: ["bash", "sh", "shell", "zsh"], id: "bash", label: "Bash" },
  { aliases: ["c"], id: "c", label: "C" },
  { aliases: ["clj", "cljs", "cljc", "clojure"], id: "clojure", label: "Clojure" },
  { aliases: ["cpp", "c++", "cc", "cxx"], id: "cpp", label: "C++" },
  { aliases: ["cs", "csharp", "c#"], id: "csharp", label: "C#" },
  { aliases: ["css"], id: "css", label: "CSS" },
  { aliases: ["dart"], id: "dart", label: "Dart" },
  { aliases: ["go", "golang"], id: "go", label: "Go" },
  { aliases: ["haskell", "hs"], id: "haskell", label: "Haskell" },
  { aliases: ["html", "xml"], id: "html", label: "HTML" },
  { aliases: ["java"], id: "java", label: "Java" },
  { aliases: ["javascript", "js", "jsx", "mjs", "cjs"], id: "jsx", label: "JavaScript" },
  { aliases: ["json"], id: "json", label: "JSON" },
  { aliases: ["julia", "jl"], id: "julia", label: "Julia" },
  { aliases: ["kotlin", "kt", "kts"], id: "kotlin", label: "Kotlin" },
  { aliases: ["lua"], id: "lua", label: "Lua" },
  { aliases: ["latex", "tex"], id: "latex", label: "LaTeX" },
  { aliases: ["markdown", "md"], id: "md", label: "Markdown" },
  { aliases: ["matlab"], id: "matlab", label: "MATLAB" },
  { aliases: ["mermaid", "mmd"], id: "mermaid", label: "Mermaid" },
  { aliases: ["objective-c", "objc"], id: "objc", label: "Objective-C" },
  { aliases: ["perl", "pl", "pm"], id: "perl", label: "Perl" },
  { aliases: ["php"], id: "php", label: "PHP" },
  {
    aliases: ["plant uml", "plant-uml", "plantuml", "puml", "uml"],
    id: "plantuml",
    label: "PlantUML",
  },
  { aliases: ["python", "py"], id: "python", label: "Python" },
  { aliases: ["r"], id: "r", label: "R" },
  { aliases: ["ruby", "rb"], id: "ruby", label: "Ruby" },
  { aliases: ["rust", "rs"], id: "rust", label: "Rust" },
  { aliases: ["scala"], id: "scala", label: "Scala" },
  { aliases: ["sql"], id: "sql", label: "SQL" },
  { aliases: ["swift"], id: "swift", label: "Swift" },
  { aliases: ["typescript", "ts", "tsx"], id: "tsx", label: "TypeScript" },
  { aliases: ["yaml", "yml"], id: "yaml", label: "YAML" },
];

const jsLikeRegex =
  /(?<comment>\/\/.*$|\/\*[\s\S]*?\*\/)|(?<string>"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`)|(?<number>\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:as|async|await|break|case|catch|class|const|continue|default|delete|else|export|extends|false|finally|for|from|function|if|import|in|instanceof|interface|let|new|null|return|switch|throw|true|try|type|typeof|undefined|var|void|while|yield)\b)|(?<builtin>\b(?:Array|Boolean|console|Date|JSON|Map|Math|Number|Object|Promise|Set|String)\b)/gm;
const cLikeRegex =
  /(?<comment>\/\/.*$|\/\*[\s\S]*?\*\/)|(?<string>L?"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|@"(?:[^"]|"")*")|(?<number>\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:f|u|l|ul|ull)?)\b)|(?<keyword>\b(?:abstract|as|async|auto|await|bool|break|byte|case|catch|char|class|const|continue|data|default|delete|do|double|else|enum|explicit|export|extends|false|final|finally|fixed|float|for|foreach|friend|func|function|goto|if|implements|import|in|inline|int|interface|internal|let|long|mutable|namespace|new|null|object|operator|override|package|private|protected|protocol|public|readonly|record|required|return|sealed|short|signed|sizeof|static|struct|super|switch|template|this|throw|throws|trait|transient|true|try|typedef|typename|uint|ulong|union|unsafe|unsigned|using|var|virtual|void|volatile|where|while)\b)|(?<builtin>\b(?:Array|Console|DateTime|List|Map|Option|Result|Self|String|System|Vec|bool|i32|i64|std|u32|u64|usize)\b)/gm;
const bashRegex =
  /(?<comment>#.*$)|(?<string>"(?:\\.|[^"])*"|'(?:\\.|[^'])*')|(?<number>\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:case|do|done|elif|else|esac|fi|for|function|if|in|select|then|until|while)\b)|(?<builtin>\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*)/gm;
const clojureRegex =
  /(?<comment>;.*$)|(?<string>"(?:\\.|[^"])*")|(?<number>\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:def|defn|defmacro|defmulti|defmethod|fn|if|if-let|if-not|let|letfn|loop|recur|when|when-let|when-not|cond|case|do|doseq|for|->|->>|some->|some->>|and|or|not|nil|true|false|ns|require|import|try|catch|finally|throw)\b)|(?<builtin>\b(?:assoc|conj|count|dissoc|filter|first|get|into|join|keys|map|merge|println|prn|reduce|rest|slurp|str|update|vals|vector)\b)/gm;
const cssRegex =
  /(?<comment>\/\*[\s\S]*?\*\/)|(?<string>"(?:\\.|[^"])*"|'(?:\\.|[^'])*')|(?<number>\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)?\b)|(?<keyword>\b(?:@media|@supports|align-items|background|border|color|display|flex|font-family|font-size|gap|grid|height|justify-content|line-height|margin|padding|position|width)\b)|(?<builtin>#[\da-fA-F]{3,8}|\.[A-Za-z_-][\w-]*|:[A-Za-z-]+)/gm;
const htmlRegex =
  /(?<comment><!--[\s\S]*?-->)|(?<string>"(?:\\.|[^"])*"|'(?:\\.|[^'])*')|(?<keyword><\/?[A-Za-z][^>\s/]*|\/?>)|(?<builtin>\b(?:class|href|id|name|src|style|type)\b)/gm;
const jsonRegex =
  /(?<string>"(?:\\.|[^"])*"(?=\s*:)|"(?:\\.|[^"])*")|(?<number>-?\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:false|null|true)\b)|(?<builtin>[{}[\],:])/gm;
const markdownRegex =
  /(?<comment>^>\s.*$)|(?<string>`[^`]+`)|(?<keyword>^(?:#{1,6}\s.*|[-*+]\s.*|\d+\.\s.*)$)|(?<builtin>\*\*[^*]+\*\*|_[^_]+_|\*[^*]+\*)/gm;
const pythonLikeRegex =
  /(?<comment>#.*$)|(?<string>"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')|(?<number>\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:and|as|async|await|break|case|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|match|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield)\b)|(?<builtin>\b(?:dict|float|int|len|list|print|range|self|set|str|tuple)\b)/gm;
const rubyLikeRegex =
  /(?<comment>#.*$)|(?<string>"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|%[qQ]?\{[\s\S]*?\})|(?<number>\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:BEGIN|END|alias|begin|break|case|class|def|defined\?|do|else|elsif|end|ensure|false|for|if|in|module|next|nil|redo|rescue|retry|return|self|super|then|true|undef|unless|until|when|while|yield)\b)|(?<builtin>\b(?:Array|Hash|Integer|Kernel|Proc|String|puts)\b)/gm;
const luaRegex =
  /(?<comment>--\[\[[\s\S]*?\]\]|--.*$)|(?<string>"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\[\[[\s\S]*?\]\])|(?<number>\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:and|break|do|else|elseif|end|false|for|function|if|in|local|nil|not|or|repeat|return|then|true|until|while)\b)|(?<builtin>\b(?:coroutine|io|math|os|package|string|table)\b)/gm;
const sqlRegex =
  /(?<comment>--.*$|\/\*[\s\S]*?\*\/)|(?<string>'(?:''|[^'])*'|"(?:\\.|[^"])*"|`[^`]*`)|(?<number>\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:add|alter|and|as|asc|between|by|case|create|delete|desc|distinct|drop|else|end|from|group|having|in|inner|insert|into|join|left|like|limit|not|null|on|or|order|outer|primary|right|select|set|table|then|union|update|values|when|where)\b)|(?<builtin>\b(?:avg|count|max|min|sum)\b)/gim;
const haskellRegex =
  /(?<comment>--.*$|\{-[\s\S]*?-\})|(?<string>"(?:\\.|[^"])*"|'(?:\\.|[^'])*')|(?<number>\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:case|class|data|default|deriving|do|else|if|import|in|infix|instance|let|module|newtype|of|then|type|where)\b)|(?<builtin>\b(?:Bool|Either|IO|Int|Just|Left|Maybe|Nothing|Right|String)\b)/gm;
const matlabRegex =
  /(?<comment>%.*$)|(?<string>"(?:\\.|[^"])*"|'(?:''|[^'])*')|(?<number>\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:break|case|catch|classdef|continue|else|elseif|end|for|function|global|if|otherwise|parfor|persistent|return|spmd|switch|try|while)\b)|(?<builtin>\b(?:disp|fprintf|length|mean|plot|size|sum)\b)/gm;
const latexRegex =
  /(?<comment>%.*$)|(?<string>\\(?:text|mathrm|mathbf|mathit|operatorname)\{[^}]*\})|(?<number>\b\d+(?:\.\d+)?\b)|(?<keyword>\\[A-Za-z]+)|(?<builtin>[{}_^&])/gm;
const yamlRegex =
  /(?<comment>#.*$)|(?<string>"(?:\\.|[^"])*"|'(?:\\.|[^'])*')|(?<number>\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:false|null|true)\b)|(?<builtin>^[A-Za-z0-9_-]+:|-\s)/gm;

function resolveLanguageOption(language: string | null | undefined) {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return null;

  return (
    languageOptions.find(
      (option) => option.id === normalized || option.aliases.some((alias) => alias === normalized),
    ) ?? null
  );
}

export function normalizeCodeLanguage(language: string | null | undefined) {
  if (!language) return null;

  const normalizedInput = language.trim().toLowerCase();
  if (["plain", "plaintext", "text", "txt"].includes(normalizedInput)) {
    return null;
  }

  const resolved = resolveLanguageOption(language);
  if (resolved) {
    return resolved.id;
  }

  return normalizedInput.length > 0 ? normalizedInput : null;
}

export function getCodeLanguageLabel(language: string | null | undefined) {
  const resolved = resolveLanguageOption(language);
  if (resolved) {
    return resolved.label;
  }

  if (!language) {
    return "Plain Text";
  }

  return language;
}

function getHighlightRegex(language: string | null) {
  switch (language) {
    case "bash":
      return bashRegex;
    case "c":
    case "clojure":
      return language === "clojure" ? clojureRegex : cLikeRegex;
    case "cpp":
    case "csharp":
    case "css":
    case "dart":
    case "go":
    case "java":
    case "kotlin":
    case "objc":
    case "php":
    case "rust":
    case "scala":
    case "swift":
      return language === "css" ? cssRegex : cLikeRegex;
    case "haskell":
      return haskellRegex;
    case "html":
      return htmlRegex;
    case "julia":
    case "python":
    case "r":
      return pythonLikeRegex;
    case "jsx":
    case "tsx":
      return jsLikeRegex;
    case "json":
      return jsonRegex;
    case "lua":
      return luaRegex;
    case "latex":
      return latexRegex;
    case "matlab":
      return matlabRegex;
    case "md":
      return markdownRegex;
    case "perl":
    case "ruby":
      return rubyLikeRegex;
    case "sql":
      return sqlRegex;
    case "yaml":
      return yamlRegex;
    default:
      return null;
  }
}

function getTokenClassName(type: string) {
  switch (type) {
    case "comment":
      return "text-slate-500 italic dark:text-slate-400";
    case "string":
      return "text-emerald-700 dark:text-emerald-300";
    case "number":
      return "text-amber-700 dark:text-amber-300";
    case "keyword":
      return "text-sky-700 dark:text-sky-300";
    case "builtin":
      return "text-violet-700 dark:text-violet-300";
    default:
      return undefined;
  }
}

function isPreviewableLanguage(language: string | null) {
  return language === "latex" || language === "mermaid" || language === "plantuml";
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

async function renderMermaidDiagram(id: string, code: string, resolvedTheme: "light" | "dark") {
  const mermaid = (await import("mermaid")).default;

  mermaid.initialize({
    fontFamily: "var(--font-sans), system-ui, sans-serif",
    securityLevel: "strict",
    startOnLoad: false,
    theme: resolvedTheme === "dark" ? "dark" : "neutral",
  });

  const { svg } = await mermaid.render(id, code);
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;

  if (root.tagName.toLowerCase() === "svg") {
    root.style.maxWidth = "none";

    const viewBox = root.getAttribute("viewBox")?.split(/\s+/).map(Number) ?? [];
    const viewBoxWidth = viewBox.length === 4 ? viewBox[2] : Number.NaN;

    if (Number.isFinite(viewBoxWidth) && viewBoxWidth > 0) {
      root.setAttribute("width", `${viewBoxWidth}`);
    }

    root.removeAttribute("height");
  }

  return root.outerHTML;
}

function renderLatex(code: string) {
  return katex.renderToString(code, {
    displayMode: true,
    output: "htmlAndMathml",
    strict: "warn",
    throwOnError: false,
    trust: false,
  });
}

export function tokenizeCode(code: string, language: string | null) {
  const regex = getHighlightRegex(language);
  if (!regex || code.length === 0) {
    return [{ value: code }];
  }

  regex.lastIndex = 0;

  const tokens: HighlightToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(code)) !== null) {
    if (match.index > cursor) {
      tokens.push({ value: code.slice(cursor, match.index) });
    }

    const groupType = Object.entries(match.groups ?? {}).find(([, value]) => Boolean(value))?.[0];
    tokens.push({
      className: groupType ? getTokenClassName(groupType) : undefined,
      value: match[0],
    });
    cursor = match.index + match[0].length;

    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }

  if (cursor < code.length) {
    tokens.push({ value: code.slice(cursor) });
  }

  return tokens;
}

function HighlightedCode({
  code,
  language,
  placeholder,
}: {
  code: string;
  language: string | null;
  placeholder?: ReactNode;
}) {
  if (code.length === 0 && placeholder) {
    return <>{placeholder}</>;
  }

  return tokenizeCode(code, language).map((token, index) => (
    <span className={token.className} key={`${index}-${token.value.length}`}>
      {token.value}
    </span>
  ));
}

function CodeBlockPreview({ code, language }: { code: string; language: string | null }) {
  const diagramId = useId().replaceAll(":", "-");
  const { resolvedTheme } = useTheme();
  const [latexHtml, setLatexHtml] = useState<string | null>(null);
  const [latexError, setLatexError] = useState<string | null>(null);
  const [mermaidSvg, setMermaidSvg] = useState<string | null>(null);
  const [mermaidError, setMermaidError] = useState<string | null>(null);
  const [plantUmlError, setPlantUmlError] = useState<string | null>(null);
  const preparedPlantUmlCode = useMemo(
    () => (language === "plantuml" ? preparePlantUmlSource(code, resolvedTheme) : code),
    [code, language, resolvedTheme],
  );
  const plantUmlUrl = useMemo(
    () => (language === "plantuml" ? buildPlantUmlUrl(preparedPlantUmlCode, "png") : null),
    [language, preparedPlantUmlCode],
  );

  useEffect(() => {
    if (language !== "latex") {
      setLatexHtml(null);
      setLatexError(null);
      return;
    }

    try {
      setLatexHtml(renderLatex(code));
      setLatexError(null);
    } catch (error) {
      setLatexHtml(null);
      setLatexError(getErrorMessage(error, "Unable to render LaTeX preview."));
    }
  }, [code, language]);

  useEffect(() => {
    setPlantUmlError(null);
  }, [language, plantUmlUrl]);

  useEffect(() => {
    let ignore = false;

    if (language !== "mermaid") {
      setMermaidSvg(null);
      setMermaidError(null);
      return;
    }

    setMermaidSvg(null);
    setMermaidError(null);

    void renderMermaidDiagram(`mermaid-${diagramId}`, code, resolvedTheme)
      .then((svg) => {
        if (ignore) return;
        setMermaidSvg(svg);
      })
      .catch((error) => {
        if (ignore) return;
        setMermaidError(getErrorMessage(error, "Unable to render Mermaid preview."));
      });

    return () => {
      ignore = true;
    };
  }, [code, diagramId, language, resolvedTheme]);

  if (code.trim().length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background/80 px-4 py-8 text-center text-sm text-muted-foreground">
        Add diagram source to preview it.
      </div>
    );
  }

  if (language === "mermaid") {
    if (mermaidError) {
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {mermaidError}
        </div>
      );
    }

    if (!mermaidSvg) {
      return (
        <div className="rounded-lg border border-border bg-background/80 px-4 py-8 text-center text-sm text-muted-foreground">
          Rendering Mermaid diagram...
        </div>
      );
    }

    return (
      <div
        className="overflow-auto rounded-lg border border-border bg-[color:oklch(0.995_0.002_95)] p-4 font-sans dark:bg-[color:oklch(0.205_0.01_265)] [&>svg]:block [&>svg]:h-auto [&>svg]:max-w-none"
        dangerouslySetInnerHTML={{ __html: mermaidSvg }}
        data-testid="code-block-diagram-preview"
      />
    );
  }

  if (language === "latex") {
    if (latexError) {
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {latexError}
        </div>
      );
    }

    if (!latexHtml) {
      return (
        <div className="rounded-lg border border-border bg-background/80 px-4 py-8 text-center text-sm text-muted-foreground">
          Rendering LaTeX preview...
        </div>
      );
    }

    return (
      <div
        className="overflow-auto rounded-lg border border-border bg-[color:oklch(0.995_0.002_95)] px-4 py-6 text-center dark:bg-[color:oklch(0.205_0.01_265)] [&_.katex-display]:my-0 [&_.katex]:text-[1.05rem]"
        dangerouslySetInnerHTML={{ __html: latexHtml }}
        data-testid="code-block-diagram-preview"
      />
    );
  }

  if (plantUmlError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {plantUmlError}
      </div>
    );
  }

  return (
    <div
      className="overflow-auto rounded-lg border border-border bg-[color:oklch(0.995_0.002_95)] p-4 font-sans dark:bg-[color:oklch(0.205_0.01_265)]"
      data-testid="code-block-diagram-preview"
    >
      <img
        alt="PlantUML diagram preview"
        className="mx-auto max-w-full"
        onError={() => {
          setPlantUmlError("Unable to load PlantUML preview.");
        }}
        onLoad={() => {
          setPlantUmlError(null);
        }}
        src={plantUmlUrl ?? ""}
      />
    </div>
  );
}

export function CodeBlockEditor({
  code,
  language,
  onChange,
  onDelete,
  onExitAfterEnd,
  onExitLeftFromStart,
  onFocusCodeBlock,
  onLanguageChange,
  onRegisterNavigation,
  readOnly = false,
}: CodeBlockEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const normalizedLanguage = normalizeCodeLanguage(language);
  const [activePanel, setActivePanel] = useState<CodeBlockPanel>("code");
  const canPreview = isPreviewableLanguage(normalizedLanguage);
  const extraLanguageOption = useMemo(() => {
    if (!normalizedLanguage) return null;
    if (languageOptions.some((option) => option.id === normalizedLanguage)) {
      return null;
    }

    return {
      id: normalizedLanguage,
      label: `${normalizedLanguage} (imported)`,
    };
  }, [normalizedLanguage]);
  const selectOptions = useMemo(
    () =>
      extraLanguageOption
        ? [...languageOptions, { ...extraLanguageOption, aliases: [] }]
        : languageOptions,
    [extraLanguageOption],
  );

  useEffect(() => {
    if (!canPreview && activePanel !== "code") {
      setActivePanel("code");
    }
  }, [activePanel, canPreview]);

  const syncCodeSurface = useCallback(() => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;
    if (!textarea || !highlight) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 160)}px`;
    highlight.scrollLeft = textarea.scrollLeft;
    highlight.scrollTop = textarea.scrollTop;
  }, []);

  const focusTextarea = useCallback((edge: "start" | "end") => {
    const textarea = textareaRef.current;
    if (!textarea) return false;

    textarea.focus();
    const offset = edge === "start" ? 0 : textarea.value.length;
    textarea.setSelectionRange(offset, offset);
    return true;
  }, []);

  const focusEditableSurface = useCallback(
    (edge: "start" | "end") => {
      if (canPreview && activePanel === "preview") {
        setActivePanel("code");
        requestAnimationFrame(() => {
          focusTextarea(edge);
        });
        return;
      }

      focusTextarea(edge);
    },
    [activePanel, canPreview, focusTextarea],
  );

  useEffect(() => {
    syncCodeSurface();
  }, [code, normalizedLanguage, syncCodeSurface]);

  useEffect(() => {
    if (!onRegisterNavigation || readOnly) return;

    onRegisterNavigation({
      focusEnd: () => {
        focusEditableSurface("end");
      },
      focusStart: () => {
        focusEditableSurface("start");
      },
    });

    return () => {
      onRegisterNavigation(null);
    };
  }, [focusEditableSurface, onRegisterNavigation, readOnly]);

  const handleScroll = useCallback((event: UIEvent<HTMLTextAreaElement>) => {
    const highlight = highlightRef.current;
    if (!highlight) return;

    highlight.scrollLeft = event.currentTarget.scrollLeft;
    highlight.scrollTop = event.currentTarget.scrollTop;
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const input = event.currentTarget;
      const selectionStart = input.selectionStart ?? 0;
      const selectionEnd = input.selectionEnd ?? 0;
      const isCollapsed = selectionStart === selectionEnd;
      const caretAtStart = isCollapsed && selectionStart === 0;
      const caretAtEnd = isCollapsed && selectionStart === input.value.length;

      if (event.key === "Backspace" && caretAtStart && input.value.length === 0) {
        event.preventDefault();
        onDelete?.();
        return;
      }

      if ((event.key === "ArrowLeft" || event.key === "ArrowUp") && caretAtStart) {
        event.preventDefault();
        input.blur();
        onExitLeftFromStart?.();
        requestAnimationFrame(() => {
          onExitLeftFromStart?.();
        });
        return;
      }

      if ((event.key === "ArrowRight" || event.key === "ArrowDown") && caretAtEnd) {
        event.preventDefault();
        input.blur();
        onExitAfterEnd?.();
        requestAnimationFrame(() => {
          onExitAfterEnd?.();
        });
      }
    },
    [onDelete, onExitAfterEnd, onExitLeftFromStart],
  );

  const codeSurface = (
    <div className="relative border-t border-border/70 bg-[color:oklch(0.985_0.002_95)] text-slate-900 dark:bg-[color:oklch(0.235_0.014_265)] dark:text-slate-100">
      <pre
        aria-hidden="true"
        className="pointer-events-none m-0 overflow-auto px-4 py-4 font-mono text-sm leading-6 whitespace-pre text-inherit"
        ref={highlightRef}
      >
        <HighlightedCode
          code={code}
          language={normalizedLanguage}
          placeholder={<span className="text-slate-400 dark:text-slate-500">Write code here</span>}
        />
      </pre>

      {readOnly ? null : (
        <textarea
          aria-label="Code block content"
          className="absolute inset-0 m-0 w-full resize-none overflow-auto border-0 bg-transparent px-4 py-4 font-mono text-sm leading-6 text-transparent caret-foreground outline-none selection:bg-sky-500/15 dark:selection:bg-sky-300/20"
          data-testid="code-block-input"
          onChange={(event) => {
            onChange?.(event.target.value);
          }}
          onFocus={() => onFocusCodeBlock?.()}
          onInput={syncCodeSurface}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onMouseDown={(event) => event.stopPropagation()}
          ref={textareaRef}
          spellCheck={false}
          value={code}
          wrap="off"
        />
      )}
    </div>
  );

  const previewPanel = canPreview ? (
    <div className="bg-[color:oklch(0.995_0.002_95)] p-4 dark:bg-[color:oklch(0.205_0.01_265)]">
      <CodeBlockPreview code={code} language={normalizedLanguage} />
    </div>
  ) : null;
  const showPreview = canPreview && (readOnly || activePanel === "preview");

  return (
    <div
      className="group relative my-4"
      contentEditable={false}
      data-testid="code-block-editor"
      onClick={(event) => event.stopPropagation()}
      onFocusCapture={() => onFocusCodeBlock?.()}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="overflow-hidden rounded-xl border border-border shadow-xs">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/45 px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="relative">
              {readOnly ? (
                <span className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                  {getCodeLanguageLabel(normalizedLanguage)}
                </span>
              ) : (
                <>
                  <select
                    aria-label="Code language"
                    className="appearance-none rounded-md border border-border bg-background py-1 pr-8 pl-2 text-xs outline-none"
                    data-testid="code-block-language"
                    onChange={(event) => {
                      const nextLanguage = event.target.value || null;
                      onLanguageChange?.(nextLanguage);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    value={normalizedLanguage ?? ""}
                  >
                    <option value="">No Highlighting</option>
                    {selectOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                </>
              )}
            </div>

            {readOnly || !canPreview ? null : (
              <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5 text-xs">
                <button
                  className={`rounded px-2 py-1 transition-colors ${
                    activePanel === "code"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground"
                  }`}
                  data-testid="code-block-panel-code"
                  onClick={() => {
                    setActivePanel("code");
                    requestAnimationFrame(() => {
                      focusTextarea("end");
                    });
                  }}
                  type="button"
                >
                  Code
                </button>
                <button
                  className={`rounded px-2 py-1 transition-colors ${
                    activePanel === "preview"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground"
                  }`}
                  data-testid="code-block-panel-preview"
                  onClick={() => {
                    setActivePanel("preview");
                  }}
                  type="button"
                >
                  Preview
                </button>
              </div>
            )}
          </div>

          {readOnly ? null : (
            <Button
              aria-label="Delete code block"
              className="px-2 text-destructive hover:text-destructive"
              data-testid="delete-code-block"
              onClick={(event) => {
                event.stopPropagation();
                onDelete?.();
              }}
              onMouseDown={(event) => event.stopPropagation()}
              size="sm"
              variant="outline"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {showPreview ? previewPanel : codeSurface}
      </div>
    </div>
  );
}
