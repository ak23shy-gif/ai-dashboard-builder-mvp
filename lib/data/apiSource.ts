import { createDataContext, normaliseRawRows, type ImportedDataset } from '@/lib/data/importData';

export type ApiSourceInput = {
  url: string;
  method: 'GET' | 'POST';
  headers?: string;
  body?: string;
  dataPath?: string;
};

type RawRow = Record<string, unknown>;

const previewLimit = 1000;
const apiTimeoutMs = 25000;

function safeSourceLabel(url: string) {
  const parsed = new URL(url);

  ['api_key', 'key', 'token', 'access_token', 'auth', 'password'].forEach((key) => {
    if (parsed.searchParams.has(key)) {
      parsed.searchParams.set(key, 'REDACTED');
    }
  });

  return parsed.toString();
}

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
  let response: Response;

  try {
    response = await fetch(url, {
      method: input.method,
      headers: {
        Accept: 'application/json',
        ...(input.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(apiTimeoutMs),
    });
  } catch (error) {
    const aborted =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError' || error.message.toLowerCase().includes('timeout'));
    throw new Error(
      aborted
        ? `API request timed out after ${Math.round(apiTimeoutMs / 1000)} seconds. Try a shorter date range, fewer properties, or fewer metrics/dimensions.`
        : error instanceof Error
          ? error.message
          : 'API request failed before a response was received.',
    );
  }

  const responseText = await response.text();

  if (!response.ok) {
    const message = responseText
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);

    throw new Error(`API request failed with ${response.status} ${response.statusText}${message ? `: ${message}` : ''}.`);
  }

  if (!responseText.trim()) {
    throw new Error('API returned an empty response. Check the endpoint, API key, date range and selected resources.');
  }

  let json: unknown;

  try {
    json = JSON.parse(responseText);
  } catch {
    throw new Error(
      `API response was not valid JSON. Received: ${responseText
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300)}`,
    );
  }

  const rows = findRows(getPathValue(json, input.dataPath)).slice(0, previewLimit);
  const { columns, mappedColumns, rows: normalisedRows } = normaliseRawRows(rows);

  if (!normalisedRows.length) {
    throw new Error(`API returned JSON, but no usable numeric rows were found. Detected rows: ${rows.length}.`);
  }

  return {
    fileName: safeSourceLabel(url),
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
    dataContext: createDataContext({
      columns,
      fileName: safeSourceLabel(url),
      mappedColumns,
      processedRowCount: normalisedRows.length,
      processedRows: normalisedRows,
      rawRowCount: rows.length,
      rawRows: rows,
      sourceType: 'api',
    }),
  };
}
