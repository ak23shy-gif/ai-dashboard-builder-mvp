import { normaliseRawRows, type ImportedDataset } from '@/lib/data/importData';

export type ApiSourceInput = {
  url: string;
  method: 'GET' | 'POST';
  headers?: string;
  body?: string;
  dataPath?: string;
};

type RawRow = Record<string, unknown>;

const previewLimit = 1000;

function parseJsonObject(value: string | undefined, fallback: Record<string, string>) {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Headers/body must be valid JSON objects.');
  }

  return parsed as Record<string, string>;
}

function getPathValue(value: unknown, path: string | undefined) {
  if (!path?.trim()) {
    return value;
  }

  return path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<unknown>((current, part) => {
      if (current && typeof current === 'object' && part in current) {
        return (current as Record<string, unknown>)[part];
      }

      return undefined;
    }, value);
}

function findRows(value: unknown): RawRow[] {
  if (Array.isArray(value)) {
    return value.filter((row): row is RawRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const commonKeys = ['data', 'results', 'items', 'records', 'rows'];

  for (const key of commonKeys) {
    const rows = findRows(record[key]);
    if (rows.length) {
      return rows;
    }
  }

  return [record];
}

function assertUrl(url: string) {
  const parsed = new URL(url);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS API URLs are supported.');
  }

  return parsed.toString();
}

export async function previewApiSource(input: ApiSourceInput): Promise<ImportedDataset> {
  const url = assertUrl(input.url);
  const headers = parseJsonObject(input.headers, {});
  const body = input.method === 'POST' ? JSON.stringify(parseJsonObject(input.body, {})) : undefined;

  const response = await fetch(url, {
    method: input.method,
    headers: {
      Accept: 'application/json',
      ...(input.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body,
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`API request failed with ${response.status} ${response.statusText}.`);
  }

  const json = await response.json();
  const rows = findRows(getPathValue(json, input.dataPath)).slice(0, previewLimit);
  const { columns, mappedColumns, rows: normalisedRows } = normaliseRawRows(rows);

  if (!normalisedRows.length) {
    throw new Error(`API returned JSON, but no usable numeric rows were found. Detected rows: ${rows.length}.`);
  }

  return {
    fileName: url,
    rows: normalisedRows,
    columns: [
      ...columns,
      `Mapped date: ${mappedColumns.date || mappedColumns.month || 'not found, defaulted to Jan'}`,
      `Mapped leads: ${mappedColumns.leads || 'not found'}`,
      `Mapped valuations: ${mappedColumns.valuations || 'calculated'}`,
      `Mapped sessions: ${mappedColumns.sessions || 'calculated'}`,
      `Mapped bookings: ${mappedColumns.bookings || 'calculated'}`,
    ],
    mappedColumns,
    rawRowCount: rows.length,
    processedRowCount: normalisedRows.length,
    isLimited: rows.length >= previewLimit,
    sourceType: 'api',
  };
}
