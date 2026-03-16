import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";

import { Button } from "./ui/button";

export type TableNavigationApi = {
  focusFirstCellStart: () => void;
  focusLastCellEnd: () => void;
};

type TableEditorProps = {
  initialData?: string[][];
  onChange: (data: string[][]) => void;
  onDelete: () => void;
  onExitAfterEnd?: () => void;
  onExitLeftFromStart?: () => void;
  onFocusTable?: () => void;
  onRegisterNavigation?: (navigation: TableNavigationApi | null) => void;
  readOnly?: boolean;
};

export function TableEditor({
  initialData,
  onChange,
  onDelete,
  onExitAfterEnd,
  onExitLeftFromStart,
  onFocusTable,
  onRegisterNavigation,
  readOnly = false,
}: TableEditorProps) {
  const fallbackData = [
    ["Header 1", "Header 2", "Header 3"],
    ["", "", ""],
  ];
  const [data, setData] = useState<string[][]>(initialData ?? fallbackData);
  const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const focusRequestVersionRef = useRef(0);
  const transientEntryDirectionRef = useRef<"left" | "right" | null>(null);
  const stopPropagation = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  useEffect(() => {
    setData(initialData ?? fallbackData);
  }, [initialData]);

  const cancelPendingCellFocus = useCallback(() => {
    focusRequestVersionRef.current += 1;
  }, []);

  const focusCell = useCallback((row: number, col: number, cursor: "start" | "end") => {
    const key = `${row}-${col}`;
    const requestVersion = focusRequestVersionRef.current + 1;
    focusRequestVersionRef.current = requestVersion;

    const focusInput = () => {
      if (focusRequestVersionRef.current !== requestVersion) return false;

      const input = cellRefs.current.get(key);
      if (!input) return false;

      input.focus();
      const caret = cursor === "start" ? 0 : input.value.length;
      input.setSelectionRange(caret, caret);
      return true;
    };

    if (focusInput()) {
      return;
    }

    requestAnimationFrame(() => {
      if (focusInput()) {
        return;
      }

      requestAnimationFrame(() => {
        focusInput();
      });
    });
  }, []);

  useEffect(() => {
    if (!onRegisterNavigation) return;

    const setTransientEntryDirection = (direction: "left" | "right") => {
      transientEntryDirectionRef.current = direction;
      requestAnimationFrame(() => {
        if (transientEntryDirectionRef.current === direction) {
          transientEntryDirectionRef.current = null;
        }
      });
    };

    onRegisterNavigation({
      focusFirstCellStart: () => {
        setTransientEntryDirection("right");
        focusCell(0, 0, "start");
      },
      focusLastCellEnd: () => {
        const lastRow = Math.max(data.length - 1, 0);
        const lastCol = Math.max((data[lastRow]?.length ?? 1) - 1, 0);
        setTransientEntryDirection("left");
        focusCell(lastRow, lastCol, "end");
      },
    });

    return () => {
      onRegisterNavigation(null);
    };
  }, [data, focusCell, onRegisterNavigation]);

  const updateCell = useCallback(
    (row: number, col: number, value: string) => {
      const nextData = data.map((currentRow, rowIndex) =>
        rowIndex === row
          ? currentRow.map((cell, colIndex) => (colIndex === col ? value : cell))
          : currentRow,
      );
      setData(nextData);
      onChange(nextData);
    },
    [data, onChange],
  );

  const addRow = useCallback(() => {
    const nextRow = Array.from({ length: data[0]?.length || 3 }, () => "");
    const nextData = [...data, nextRow];
    setData(nextData);
    onChange(nextData);
  }, [data, onChange]);

  const addColumn = useCallback(() => {
    const nextData = data.map((row, rowIndex) => [
      ...row,
      rowIndex === 0 ? `Header ${row.length + 1}` : "",
    ]);
    setData(nextData);
    onChange(nextData);
  }, [data, onChange]);

  const removeRow = useCallback(
    (index: number) => {
      if (data.length <= 2) return;

      const nextData = data.filter((_, rowIndex) => rowIndex !== index);
      setData(nextData);
      onChange(nextData);
    },
    [data, onChange],
  );

  const removeColumn = useCallback(
    (index: number) => {
      if ((data[0]?.length ?? 0) <= 1) return;

      const nextData = data.map((row) => row.filter((_, colIndex) => colIndex !== index));
      setData(nextData);
      onChange(nextData);
    },
    [data, onChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, row: number, col: number) => {
      const input = event.currentTarget as HTMLInputElement;
      const caretAtStart = input.selectionStart === 0 && input.selectionEnd === 0;
      const caretAtEnd =
        input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
      const transientEntryDirection = transientEntryDirectionRef.current;

      if (event.key === "ArrowLeft" && transientEntryDirection === "left" && caretAtStart) {
        event.preventDefault();
        transientEntryDirectionRef.current = null;
        return;
      }

      if (event.key === "ArrowRight" && transientEntryDirection === "right" && caretAtEnd) {
        event.preventDefault();
        transientEntryDirectionRef.current = null;
        return;
      }

      if (event.key === "ArrowLeft" && caretAtStart) {
        event.preventDefault();

        if (col > 0) {
          focusCell(row, col - 1, "end");
          return;
        }

        if (row > 0) {
          const previousRow = row - 1;
          const previousCol = Math.max((data[previousRow]?.length ?? 1) - 1, 0);
          focusCell(previousRow, previousCol, "end");
          return;
        }

        cancelPendingCellFocus();
        onExitLeftFromStart?.();
        return;
      }

      if (event.key === "ArrowRight" && caretAtEnd) {
        event.preventDefault();

        const lastCol = Math.max((data[0]?.length ?? 1) - 1, 0);
        if (col < lastCol) {
          focusCell(row, col + 1, "start");
          return;
        }

        if (row < data.length - 1) {
          focusCell(row + 1, 0, "start");
          return;
        }

        cancelPendingCellFocus();
        onExitAfterEnd?.();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        const reverse = event.shiftKey;
        let nextRow = row;
        let nextCol = col;

        if (reverse) {
          nextCol -= 1;
          if (nextCol < 0) {
            nextCol = (data[0]?.length ?? 1) - 1;
            nextRow -= 1;
          }
        } else {
          nextCol += 1;
          if (nextCol >= (data[0]?.length ?? 1)) {
            nextCol = 0;
            nextRow += 1;
          }
        }

        if (nextRow >= data.length) {
          addRow();
          nextRow = data.length;
        }

        if (nextRow >= 0 && nextRow < data.length) {
          const key = `${nextRow}-${nextCol}`;
          setTimeout(() => {
            cellRefs.current.get(key)?.focus();
          }, 0);
        }
      } else if (event.key === "ArrowUp" && row > 0) {
        event.preventDefault();
        focusCell(row - 1, col, "end");
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (row < data.length - 1) {
          focusCell(row + 1, col, "end");
          return;
        }

        cancelPendingCellFocus();
        onExitAfterEnd?.();
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (row < data.length - 1) {
          focusCell(row + 1, col, "end");
        } else {
          addRow();
          focusCell(data.length, col, "end");
        }
      }
    },
    [addRow, cancelPendingCellFocus, data, focusCell, onExitAfterEnd, onExitLeftFromStart],
  );

  return (
    <div
      className="group relative my-4"
      contentEditable={false}
      data-testid="table-editor"
      onClick={(event) => event.stopPropagation()}
      onFocusCapture={() => onFocusTable?.()}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {data[0]?.map((cell, colIndex) => (
                <th
                  key={colIndex}
                  className="relative border-r border-b border-border bg-muted/50 p-0 last:border-r-0"
                >
                  {!readOnly ? (
                    <button
                      type="button"
                      aria-label={`Remove column ${colIndex + 1}`}
                      data-testid={`remove-column-${colIndex + 1}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeColumn(colIndex);
                      }}
                      onMouseDown={stopPropagation}
                      className="absolute right-1 top-1 z-10 flex items-center justify-center p-1 text-muted-foreground opacity-0 transition-colors transition-opacity group-hover:opacity-100 hover:text-destructive"
                      title="Remove column"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                  ) : null}

                  <input
                    ref={(element) => {
                      if (element) cellRefs.current.set(`0-${colIndex}`, element);
                    }}
                    type="text"
                    value={cell}
                    data-testid={`header-cell-${colIndex + 1}`}
                    onBeforeInput={stopPropagation}
                    onInput={stopPropagation}
                    onChange={(event) => {
                      event.stopPropagation();
                      updateCell(0, colIndex, event.target.value);
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      handleKeyDown(event, 0, colIndex);
                    }}
                    onMouseDown={stopPropagation}
                    readOnly={readOnly}
                    className="min-w-[100px] w-full bg-transparent px-3 py-2 pr-8 font-semibold text-foreground outline-none focus:bg-muted/30"
                    placeholder="Header"
                  />
                </th>
              ))}

              {!readOnly ? (
                <th className="w-8 border-b border-border bg-muted/50">
                  <button
                    type="button"
                    aria-label="Add column"
                    data-testid="add-column"
                    onClick={(event) => {
                      event.stopPropagation();
                      addColumn();
                    }}
                    onMouseDown={stopPropagation}
                    className="flex h-full w-full items-center justify-center p-2 text-muted-foreground transition-colors hover:text-foreground"
                    title="Add column"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </th>
              ) : null}
            </tr>
          </thead>

          <tbody>
            {data.slice(1).map((row, rowIndex) => (
              <tr key={rowIndex + 1} className="group/row">
                {row.map((cell, colIndex) => (
                  <td
                    key={colIndex}
                    className="border-r border-b border-border p-0 last:border-r-0"
                  >
                    <input
                      ref={(element) => {
                        if (element) cellRefs.current.set(`${rowIndex + 1}-${colIndex}`, element);
                      }}
                      type="text"
                      value={cell}
                      data-testid={`body-cell-${rowIndex + 1}-${colIndex + 1}`}
                      onBeforeInput={stopPropagation}
                      onInput={stopPropagation}
                      onChange={(event) => {
                        event.stopPropagation();
                        updateCell(rowIndex + 1, colIndex, event.target.value);
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        handleKeyDown(event, rowIndex + 1, colIndex);
                      }}
                      onMouseDown={stopPropagation}
                      readOnly={readOnly}
                      className="min-w-[100px] w-full bg-transparent px-3 py-2 text-foreground outline-none focus:bg-muted/30"
                      placeholder="..."
                    />
                  </td>
                ))}

                {!readOnly ? (
                  <td className="w-8 border-b border-border">
                    <button
                      type="button"
                      aria-label={`Remove row ${rowIndex + 1}`}
                      data-testid={`remove-row-${rowIndex + 1}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeRow(rowIndex + 1);
                      }}
                      onMouseDown={stopPropagation}
                      className="flex h-full w-full items-center justify-center p-2 text-muted-foreground opacity-0 transition-colors group-hover/row:opacity-100 hover:text-destructive"
                      title="Remove row"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly ? (
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="add-row"
            onClick={(event) => {
              event.stopPropagation();
              addRow();
            }}
            onMouseDown={stopPropagation}
            className="text-xs"
          >
            <Plus className="mr-1 h-3 w-3" /> Add Row
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="delete-table"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            onMouseDown={stopPropagation}
            className="text-xs text-destructive hover:text-destructive"
          >
            <X className="mr-1 h-3 w-3" /> Delete Table
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type TableSizeSelectorProps = {
  onSelect: (rows: number, cols: number) => void;
  onClose: () => void;
};

export function TableSizeSelector({ onSelect, onClose }: TableSizeSelectorProps) {
  const [hovered, setHovered] = useState({ rows: 0, cols: 0 });
  const maxRows = 6;
  const maxCols = 6;

  return (
    <div className="rounded-lg border border-border bg-popover p-3 shadow-lg">
      <p className="mb-2 text-sm text-muted-foreground">
        {hovered.rows > 0 ? `${hovered.rows} x ${hovered.cols}` : "Select size"}
      </p>

      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${maxCols}, 1fr)` }}>
        {Array.from({ length: maxRows * maxCols }).map((_, index) => {
          const row = Math.floor(index / maxCols) + 1;
          const col = (index % maxCols) + 1;
          const highlighted = row <= hovered.rows && col <= hovered.cols;

          return (
            <button
              key={index}
              type="button"
              aria-label={`Insert table ${row + 1} rows ${col} columns`}
              data-testid={`table-size-${row + 1}x${col}`}
              className={`h-5 w-5 rounded border transition-colors ${
                highlighted
                  ? "border-foreground bg-foreground"
                  : "border-border bg-muted hover:border-foreground/50"
              }`}
              onMouseEnter={() => setHovered({ rows: row, cols: col })}
              onMouseLeave={() => setHovered({ rows: 0, cols: 0 })}
              onClick={() => {
                onSelect(row + 1, col);
                onClose();
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
