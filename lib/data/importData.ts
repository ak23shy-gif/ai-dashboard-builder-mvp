import * as XLSX from 'xlsx';
import type { MarketingRow } from '@/lib/data/mockData';

export type ImportedDataset = {
  fileName: string;
  rows: MarketingRow[];
  columns: string[];
  mappedColumns: {
    date?: string;
    month?: string;
    year?: string;
    brand?: string;
    channel?: string;
    leads?: string;
    valuations?: string;
    sessions?: string;
    bookings?: string;
  };
  rawRowCount: number;
  processedRowCount: number;
  isLimited: boolean;
  sourceType: 'csv' | 'excel' | 'database' | 'api';
};

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type RawRow = Record<string, unknown>;

const maxImportedRows = 10000;
const maxImportColumns = 80;

const columnAliases = {
  date: ['date', 'created date', 'created at', 'created on', 'closed date', 'resolved date', 'order date', 'invoice date', 'month date', 'period', 'timestamp'],
  month: ['month', 'month name', 'period month', 'created month', 'month year', 'reporting month'],
  year: ['year'],
  brand: ['brand', 'company', 'business', 'client', 'category', 'team', 'department'],
  channel: ['channel', 'source', 'traffic source', 'medium', 'priority', 'severity', 'status', 'agent'],
  leads: ['leads', 'lead', 'total leads', 'lead count', 'tickets', 'tickets created', 'created', 'cases', 'requests'],
  valuations: ['valuations', 'valuation', 'total valuations', 'valuation count', 'tickets closed', 'closed', 'resolved'],
  sessions: ['sessions', 'website sessions', 'visits', 'traffic', 'views', 'volume'],
  bookings: ['bookings', 'booking', 'appointments', 'sales', 'sla', 'sla met', 'wins'],
};

function normaliseHeader(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesAlias(column: string, alias: string) {
  return new RegExp(`(^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(column);
}

function findColumn(columns: string[], aliases: string[]) {
  const normalised = columns.map((column) => ({ original: column, normalised: normaliseHeader(column) }));
  return (
    normalised.find((column) => aliases.includes(column.normalised))?.original ||
    normalised.find((column) =>
      aliases.some((alias) => matchesAlias(column.normalised, alias)),
    )?.original
  );
}

function hasNumericValue(rows: RawRow[], column: string) {
  return rows.some((row) => toNumber(row[column]) > 0);
}

function findNumericColumns(rows: RawRow[], columns: string[]) {
  return columns.filter((column) => hasNumericValue(rows, column));
}

function findTextColumns(rows: RawRow[], columns: string[]) {
  return columns.filter((column) =>
    rows.some((row) => {
      const value = String(row[column] ?? '').trim();
      return value && Number.isNaN(Number(value));
    }),
  );
}

function firstAvailable(columns: string[], usedColumns: Array<string | undefined>) {
  return columns.find((column) => !usedColumns.includes(column));
}

function toNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  }

  const parsed = Number(String(value ?? '').replace(/[,%£$]/g, '').trim());
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normaliseYear(value: number) {
  if (value >= 0 && value < 100) {
    return 2000 + value;
  }

  if (value >= 1900 && value <= 2200) {
    return value;
  }

  return 2026;
}

function createDateParts(monthIndex: number, year: number) {
  const safeMonthIndex = Math.min(Math.max(Math.round(monthIndex), 1), 12);
  const safeYear = normaliseYear(Math.round(year));

  return {
    date: `${safeYear}-${String(safeMonthIndex).padStart(2, '0')}-01`,
    month: monthNames[safeMonthIndex - 1],
    monthIndex: safeMonthIndex,
    year: safeYear,
  };
}

function parseExcelSerialDate(value: number) {
  if (value < 20000 || value > 80000) {
    return null;
  }

  const parsed = XLSX.SSF.parse_date_code(value);
  if (!parsed?.m || !parsed?.y) {
    return null;
  }

  return createDateParts(parsed.m, parsed.y);
}

function parseDateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return createDateParts(value.getMonth() + 1, value.getFullYear());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return parseExcelSerialDate(value);
  }

  const rawValue = String(value ?? '').trim();
  if (!rawValue) {
    return null;
  }

  const monthNameIndex = monthNames.findIndex((month) =>
    rawValue.toLowerCase().includes(month.toLowerCase()),
  );
  const yearMatch = rawValue.match(/\b(19|20|21|22)\d{2}\b/);
  const twoDigitYearMatch = rawValue.match(/\b(\d{2})\b/);

  if (monthNameIndex >= 0) {
    return createDateParts(
      monthNameIndex + 1,
      yearMatch ? Number(yearMatch[0]) : twoDigitYearMatch ? normaliseYear(Number(twoDigitYearMatch[1])) : 2026,
    );
  }

  const isoMatch = rawValue.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?/);
  if (isoMatch) {
    return createDateParts(Number(isoMatch[2]), Number(isoMatch[1]));
  }

  const slashDateMatch = rawValue.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashDateMatch) {
    const first = Number(slashDateMatch[1]);
    const second = Number(slashDateMatch[2]);
    const year = normaliseYear(Number(slashDateMatch[3]));
    const monthIndex = first > 12 ? second : second > 12 ? first : second;

    return createDateParts(monthIndex, year);
  }

  const numericMonth = Number(rawValue);
  if (Number.isFinite(numericMonth) && numericMonth >= 1 && numericMonth <= 12) {
    return createDateParts(numericMonth, 2026);
  }

  const parsedDate = new Date(rawValue);
  if (!Number.isNaN(parsedDate.getTime())) {
    return createDateParts(parsedDate.getMonth() + 1, parsedDate.getFullYear());
  }

  return null;
}

function parseDateParts(row: RawRow, columns: string[]) {
  const dateColumn = findColumn(columns, columnAliases.date);
  const monthColumn = findColumn(columns, columnAliases.month);
  const yearColumn = findColumn(columns, columnAliases.year);

  const dateValue = dateColumn ? row[dateColumn] : null;
  const dateParts = parseDateValue(dateValue);

  if (dateParts) {
    return dateParts;
  }

  const monthParts = monthColumn ? parseDateValue(row[monthColumn]) : null;
  const parsedYear = yearColumn ? normaliseYear(toNumber(row[yearColumn])) : 2026;

  return monthParts
    ? createDateParts(monthParts.monthIndex, yearColumn ? parsedYear : monthParts.year)
    : createDateParts(1, parsedYear);
}

export function normaliseRawRows(rawRows: RawRow[]) {
  const columns = Object.keys(rawRows[0] || {}).slice(0, maxImportColumns);
  const numericColumns = findNumericColumns(rawRows, columns);
  const textColumns = findTextColumns(rawRows, columns);
  const brandColumn = findColumn(columns, columnAliases.brand) || textColumns[0];
  const channelColumn = findColumn(columns, columnAliases.channel) || textColumns.find((column) => column !== brandColumn) || brandColumn;
  const leadsColumn = findColumn(columns, columnAliases.leads) || numericColumns[0];
  const valuationsColumn = findColumn(columns, columnAliases.valuations) || firstAvailable(numericColumns, [leadsColumn]);
  const sessionsColumn = findColumn(columns, columnAliases.sessions) || firstAvailable(numericColumns, [leadsColumn, valuationsColumn]);
  const bookingsColumn = findColumn(columns, columnAliases.bookings) || firstAvailable(numericColumns, [leadsColumn, valuationsColumn, sessionsColumn]);

  const rows = rawRows
    .map((row) => {
      const dateParts = parseDateParts(row, columns);
      const leads = leadsColumn ? toNumber(row[leadsColumn]) : 0;
      const valuations = valuationsColumn ? toNumber(row[valuationsColumn]) : 0;
      const sessions = sessionsColumn ? toNumber(row[sessionsColumn]) : Math.max(leads * 18, valuations * 8);
      const bookings = bookingsColumn ? toNumber(row[bookingsColumn]) : Math.round(Math.max(valuations * 0.22, leads * 0.08));

      return {
        ...dateParts,
        brand: brandColumn ? String(row[brandColumn] || 'Uploaded Brand').trim() : 'Uploaded Brand',
        channel: channelColumn ? String(row[channelColumn] || 'Uploaded Channel').trim() : 'Uploaded Channel',
        leads,
        valuations,
        sessions,
        bookings,
      };
    })
    .filter((row) => row.leads + row.valuations + row.sessions + row.bookings > 0);

  return {
    columns,
    rows,
    mappedColumns: {
      date: findColumn(columns, columnAliases.date),
      month: findColumn(columns, columnAliases.month),
      year: findColumn(columns, columnAliases.year),
      leads: leadsColumn,
      valuations: valuationsColumn,
      sessions: sessionsColumn,
      bookings: bookingsColumn,
      brand: brandColumn,
      channel: channelColumn,
    },
  };
}

function parseCsvText(text: string): RawRow[] {
  const workbook = XLSX.read(text, { type: 'string', sheetRows: maxImportedRows + 1 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return sheetToJsonRows(sheet);
}

function parseExcelBuffer(buffer: ArrayBuffer): RawRow[] {
  const workbook = XLSX.read(buffer, { type: 'array', sheetRows: maxImportedRows + 1 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return sheetToJsonRows(sheet);
}

function sheetToJsonRows(sheet: XLSX.WorkSheet | undefined): RawRow[] {
  if (!sheet) {
    return [];
  }

  const safeRef = getSafeSheetRange(sheet);
  if (!safeRef) {
    return [];
  }

  try {
    return XLSX.utils.sheet_to_json<RawRow>(sheet, {
      defval: '',
      blankrows: false,
      range: safeRef,
    });
  } catch (error) {
    if (error instanceof RangeError || String(error).includes('Invalid array length')) {
      throw new Error('This workbook has a very large or sparse used range. Please clear unused rows/columns in Excel or save the active table as CSV and upload again.');
    }

    throw error;
  }
}

function getSafeSheetRange(sheet: XLSX.WorkSheet) {
  const cellRefs = Object.keys(sheet).filter((key) => /^[A-Z]+[0-9]+$/i.test(key));

  if (cellRefs.length) {
    const cells = cellRefs.map((cellRef) => XLSX.utils.decode_cell(cellRef));
    const minRow = Math.min(...cells.map((cell) => cell.r));
    const minCol = Math.min(...cells.map((cell) => cell.c));
    const maxRow = Math.min(Math.max(...cells.map((cell) => cell.r)), minRow + maxImportedRows);
    const maxCol = Math.min(Math.max(...cells.map((cell) => cell.c)), minCol + maxImportColumns - 1);

    return XLSX.utils.encode_range({
      s: { r: minRow, c: minCol },
      e: { r: maxRow, c: maxCol },
    });
  }

  if (!sheet['!ref']) {
    return null;
  }

  const range = XLSX.utils.decode_range(sheet['!ref']);
  range.e.r = Math.min(range.e.r, range.s.r + maxImportedRows);
  range.e.c = Math.min(range.e.c, range.s.c + maxImportColumns - 1);

  return XLSX.utils.encode_range(range);
}

export async function importDashboardFile(file: File): Promise<ImportedDataset> {
  const lowerName = file.name.toLowerCase();
  const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');
  const isCsv = lowerName.endsWith('.csv');

  if (!isCsv && !isExcel) {
    throw new Error('Please upload a CSV, XLS or XLSX file.');
  }

  const rawRows = isExcel
    ? parseExcelBuffer(await file.arrayBuffer())
    : parseCsvText(await file.text());
  const limitedRawRows = rawRows.slice(0, maxImportedRows);
  const { columns, mappedColumns, rows } = normaliseRawRows(limitedRawRows);

  if (!rows.length) {
    throw new Error(
      `The file was read, but no usable numeric rows were found. Detected columns: ${columns.join(', ') || 'none'}.`,
    );
  }

  return {
    fileName: file.name,
    rows,
    columns: [
      ...columns,
      `Mapped date: ${mappedColumns.date || mappedColumns.month || 'not found, defaulted to Jan'}`,
      `Mapped leads: ${mappedColumns.leads || 'not found'}`,
      `Mapped valuations: ${mappedColumns.valuations || 'calculated'}`,
      `Mapped sessions: ${mappedColumns.sessions || 'calculated'}`,
      `Mapped bookings: ${mappedColumns.bookings || 'calculated'}`,
    ],
    mappedColumns,
    rawRowCount: rawRows.length,
    processedRowCount: rows.length,
    isLimited: rawRows.length >= maxImportedRows,
    sourceType: isExcel ? 'excel' : 'csv',
  };
}
