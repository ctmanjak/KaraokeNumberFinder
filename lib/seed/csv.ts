import { readFileSync, writeFileSync } from "node:fs";

export type CsvRecord = {
  rowNumber: number;
  values: Record<string, string>;
};

export function readCsvRows(filePath: string): string[][] {
  return parseCsv(readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

export function writeCsvRows(
  filePath: string,
  rows: readonly string[][]
): void {
  writeFileSync(filePath, `${stringifyCsvRows(rows)}\n`, "utf8");
}

export function recordsFromCsvRows(
  header: readonly string[],
  rows: readonly string[][]
): CsvRecord[] {
  return rows.slice(1).flatMap((row, index) => {
    if (row.length === 1 && isBlank(row[0])) {
      return [];
    }

    return [
      {
        rowNumber: index + 2,
        values: Object.fromEntries(
          header.map((column, columnIndex) => [column, row[columnIndex] ?? ""])
        )
      }
    ];
  });
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0 || text.endsWith(",")) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function stringifyCsvRows(rows: readonly string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");
}

function escapeCsvField(value: string): string {
  if (!/[",\n\r]/u.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}
