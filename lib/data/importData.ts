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
  bookings: ['bookings', 'booking', 'appointments', 'orders', 'transactions', 'units', 'quantity', 'wins'],
};

const valueMeasureAliases = ['sales', 'revenue', 'amount', 'total amount', 'value', 'gross sales', 'net sales', 'cost', 'profit', 'margin'];
const supportingMeasureAliases = ['discount', 'tax', 'shipping', 'freight', 'price', 'rate', 'score', 'duration'];
const identifierAliases = ['id', 'order id', 'customer id', 'product id', 'row id', 'record id', 'number', 'no', 'code', 'key', 'sku', 'reference'];

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

function distinctCount(rows: RawRow[], column: string) {
  return new Set(
    rows
      .map((row) => String(row[column] ?? '').trim())
      .filter(Boolean),
  ).size;
}

function isDateLikeColumn(column: string) {
  const normalised = normaliseHeader(column);
  return [...columnAliases.date, ...columnAliases.month, ...columnAliases.year].some(
    (alias) => normalised === alias || matchesAlias(normalised, alias),
  );
}

function isIdentifierColumn(column: string) {
  const normalised = normaliseHeader(column);
  return identifierAliases.some((alias) => normalised === alias || matchesAlias(normalised, alias));
}

function findCategoricalColumn(rows: RawRow[], columns: string[], usedColumns: Array<string | undefined> = []) {
  const candidates = columns
    .filter((column) => !usedColumns.includes(column))
    .filter((column) => !isDateLikeColumn(column))
    .map((column) => ({
      column,
      distinctValues: distinctCount(rows, column),
    }))
    .filter(({ distinctValues }) => distinctValues > 1 && distinctValues <= Math.min(50, Math.max(8, rows.length * 0.6)));

  return candidates.sort((a, b) => a.distinctValues - b.distinctValues)[0]?.column;
}

function firstAvailable(columns: string[], usedColumns: Array<string | undefined>) {
  return columns.find((column) => !usedColumns.includes(column));
}

function findMeasureColumn(columns: string[], aliases: string[], usedColumns: Array<string | undefined> = []) {
  return findColumn(
    columns.filter((column) => !usedColumns.includes(column)),
    aliases,
  );
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
  const numericColumns = findNumericColumns(rawRows, columns).filter((column) => !isIdentifierColumn(column));
  const textColumns = findTextColumns(rawRows, columns).filter((column) => !isDateLikeColumn(column));
  const aliasBrandColumn = findColumn(textColumns, columnAliases.brand);
  const aliasChannelColumn = findColumn(textColumns, columnAliases.channel);
  const brandColumn = aliasBrandColumn || findCategoricalColumn(rawRows, textColumns);
  const channelColumn =
    aliasChannelColumn ||
    findCategoricalColumn(rawRows, textColumns, [brandColumn]) ||
    brandColumn;
  const leadsColumn = findMeasureColumn(numericColumns, valueMeasureAliases) || findMeasureColumn(numericColumns, columnAliases.leads) || numericColumns[0];
  const valuationsColumn =
    findMeasureColumn(numericColumns, supportingMeasureAliases, [leadsColumn]) ||
    findMeasureColumn(numericColumns, columnAliases.valuations, [leadsColumn]) ||
    firstAvailable(numericColumns, [leadsColumn]);
  const sessionsColumn = findMeasureColumn(numericColumns, columnAliases.sessions, [leadsColumn, valuationsColumn]) || firstAvailable(numericColumns, [leadsColumn, valuationsColumn]);
  const bookingsColumn = findMeasureColumn(numericColumns, columnAliases.bookings, [leadsColumn, valuationsColumn, sessionsColumn]) || firstAvailable(numericColumns, [leadsColumn, valuationsColumn, sessionsColumn]);

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
  const rows = parseDelimitedRows(text);
  const headers = rows[0]?.slice(0, maxImportColumns).map((header, index) => normaliseDisplayHeader(header, index)) || [];

  return rows
    .slice(1, maxImportedRows + 1)
    .map((row) =>
      headers.reduce<RawRow>((item, header, index) => {
        item[header] = row[index] ?? '';
        return item;
      }, {}),
    )
    .filter((row) => Object.values(row).some((value) => String(value ?? '').trim()));
}

function parseExcelBuffer(buffer: ArrayBuffer): RawRow[] {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    sheetRows: maxImportedRows + 1,
    cellDates: true,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    WTF: false,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return sheetToJsonRows(sheet);
}

function sheetToJsonRows(sheet: XLSX.WorkSheet | undefined): RawRow[] {
  if (!sheet) {
    return [];
  }

  const bounds = getRealSheetBounds(sheet);
  if (!bounds) {
    return [];
  }

  const headers: string[] = [];
  for (let column = bounds.minCol; column <= bounds.maxCol; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: bounds.headerRow, c: column })] as XLSX.CellObject | undefined;
    headers.push(normaliseDisplayHeader(readCellValue(cell), column - bounds.minCol));
  }

  const rows: RawRow[] = [];
  for (let rowNumber = bounds.headerRow + 1; rowNumber <= bounds.maxRow; rowNumber += 1) {
    const row = headers.reduce<RawRow>((item, header, index) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowNumber, c: bounds.minCol + index })] as XLSX.CellObject | undefined;
      item[header] = readCellValue(cell);
      return item;
    }, {});

    if (Object.values(row).some((value) => String(value ?? '').trim())) {
      rows.push(row);
    }
  }

  return rows;
}

function getRealSheetBounds(sheet: XLSX.WorkSheet) {
  let minRow = Number.POSITIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxRow = 0;
  let maxCol = 0;
  let hasCell = false;

  for (const key of Object.keys(sheet)) {
    if (!/^[A-Z]+[0-9]+$/i.test(key)) {
      continue;
    }

    const cell = sheet[key] as XLSX.CellObject | undefined;
    if (String(readCellValue(cell) ?? '').trim() === '') {
      continue;
    }

    const decoded = XLSX.utils.decode_cell(key);
    minRow = Math.min(minRow, decoded.r);
    minCol = Math.min(minCol, decoded.c);
    maxRow = Math.max(maxRow, decoded.r);
    maxCol = Math.max(maxCol, decoded.c);
    hasCell = true;
  }

  if (!hasCell) {
    return null;
  }

  return {
    headerRow: minRow,
    minCol,
    maxRow: Math.min(maxRow, minRow + maxImportedRows),
    maxCol: Math.min(maxCol, minCol + maxImportColumns - 1),
  };
}

function readCellValue(cell: XLSX.CellObject | undefined) {
  if (!cell) {
    return '';
  }

  if (cell.v instanceof Date) {
    return cell.v;
  }

  return cell.v ?? cell.w ?? '';
}

function normaliseDisplayHeader(value: unknown, index: number) {
  const header = String(value ?? '').trim();
  return header || `Column ${index + 1}`;
}

function parseDelimitedRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }

      row.push(value);
      value = '';

      if (rows.length <= maxImportedRows && row.some((cell) => cell.trim())) {
        rows.push(row.slice(0, maxImportColumns));
      }

      row = [];
      continue;
    }

    value += character;
  }

  row.push(value);
  if (rows.length <= maxImportedRows && row.some((cell) => cell.trim())) {
    rows.push(row.slice(0, maxImportColumns));
  }

  return rows;
}

export async function importDashboardFile(file: File): Promise<ImportedDataset> {
  const lowerName = file.name.toLowerCase();
  const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');
  const isCsv = lowerName.endsWith('.csv');

  if (!isCsv && !isExcel) {
    throw new Error('Please upload a CSV, XLS or XLSX file.');
  }

  let rawRows: RawRow[];

  try {
    rawRows = isExcel
      ? parseExcelBuffer(await file.arrayBuffer())
      : parseCsvText(await file.text());
  } catch (error) {
    if (error instanceof RangeError || String(error).includes('Invalid array length')) {
      throw new Error(
        'This file has an unusually large or sparse used range. Please open it in Excel, select the real data table, save it as a fresh CSV/XLSX file, then upload that cleaned file.',
      );
    }

    throw error;
  }
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
