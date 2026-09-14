import * as XLSX from 'xlsx';
import type { MarketingRow } from '@/lib/data/mockData';

export type DataFieldRole = 'date' | 'dimension' | 'measure' | 'currency' | 'percentage' | 'identifier' | 'unknown';

export type DataFieldProfile = {
  name: string;
  label: string;
  role: DataFieldRole;
  mappedTo?: keyof ImportedDataset['mappedColumns'];
  distinctValues: number;
  sampleValues: string[];
};

export type DashboardDataContext = {
  sourceName: string;
  sourceType: ImportedDataset['sourceType'];
  rawRowCount: number;
  processedRowCount: number;
  rawRows?: Array<Record<string, unknown>>;
  grain?: string;
  timeRange?: {
    label: string;
    frequency: string;
    start?: string;
    end?: string;
  };
  fields: DataFieldProfile[];
  metricSlots: {
    leads?: string;
    valuations?: string;
    sessions?: string;
    bookings?: string;
  };
  dimensionSlots: {
    date?: string;
    primary?: string;
    secondary?: string;
  };
  analystBrief?: AnalystBrief;
};

export type AnalystBrief = {
  domain: string;
  grain: string;
  businessQuestion: string;
  audience: string;
  kpis: Array<{
    label: string;
    sourceColumn: string;
    formula: string;
    aggregation: 'SUM' | 'AVERAGE' | 'DISTINCTCOUNT' | 'RATIO' | 'NONE';
    role: DataFieldRole;
    reason: string;
  }>;
  comparisons: string[];
  filters: string[];
  warnings: string[];
  anomalies: string[];
  keyInsights: string[];
  dashboardPlan: string[];
  caveats: string[];
  layout: string[];
};

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
  dataContext?: DashboardDataContext;
};

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type RawRow = Record<string, unknown>;

const maxImportedRows = 10000;
const maxImportColumns = 80;

const columnAliases = {
  date: ['date', 'created date', 'created at', 'created on', 'closed date', 'resolved date', 'order date', 'invoice date', 'month date', 'period', 'timestamp'],
  month: ['month', 'month name', 'period month', 'created month', 'month year', 'reporting month'],
  year: ['year'],
  brand: ['brand', 'company', 'business', 'client', 'category', 'product category', 'team', 'department'],
  channel: ['channel', 'source', 'traffic source', 'medium', 'priority', 'severity', 'status', 'agent', 'region', 'segment', 'market', 'location', 'country'],
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

function isCurrencyLikeColumn(column: string | undefined) {
  if (!column) {
    return false;
  }

  const normalised = normaliseHeader(column);
  return valueMeasureAliases.some((alias) => normalised === alias || matchesAlias(normalised, alias));
}

function inferDomain(columns: string[], fileName: string) {
  const text = normaliseHeader(`${fileName} ${columns.join(' ')}`);

  if (/\b(order|sales|revenue|profit|customer|retail|invoice|product)\b/.test(text)) {
    return 'Commercial / transaction performance data';
  }

  if (/\b(employee|hr|salary|department|absence|attrition|headcount)\b/.test(text)) {
    return 'HR / workforce data';
  }

  if (/\b(patient|clinic|health|appointment|diagnosis|treatment)\b/.test(text)) {
    return 'Healthcare / service activity data';
  }

  if (/\b(shipment|delivery|warehouse|route|carrier|stock|inventory)\b/.test(text)) {
    return 'Logistics / operations data';
  }

  if (/\b(session|campaign|lead|channel|traffic|conversion|website|ga4|analytics)\b/.test(text)) {
    return 'Marketing / digital analytics data';
  }

  if (/\b(ticket|case|incident|sla|priority|status|resolved)\b/.test(text)) {
    return 'Service / support operations data';
  }

  return 'General business dataset';
}

function shouldUseAsKpi(field: DataFieldProfile) {
  const name = normaliseHeader(field.name);

  if (field.role === 'identifier' || field.role === 'date' || field.role === 'unknown') {
    return false;
  }

  if (/\b(id|key|code|sku|reference|latitude|longitude|postal|zip)\b/.test(name)) {
    return false;
  }

  return ['measure', 'currency', 'percentage'].includes(field.role);
}

function aggregationForRole(field: DataFieldProfile): AnalystBrief['kpis'][number]['aggregation'] {
  if (field.role === 'percentage') {
    return 'AVERAGE';
  }

  if (field.role === 'currency' || field.role === 'measure') {
    return 'SUM';
  }

  return 'NONE';
}

function formulaForField(field: DataFieldProfile) {
  const aggregation = aggregationForRole(field);

  if (aggregation === 'NONE') {
    return 'Not used as a KPI';
  }

  return `${aggregation}([${field.name}])`;
}

function formatBriefNumber(value: number) {
  const absoluteValue = Math.abs(value);

  if (absoluteValue < 10000) {
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
  }

  return new Intl.NumberFormat('en-GB', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: absoluteValue >= 100000 ? 0 : 1,
  }).format(value);
}

function metricKeyForField(field: DataFieldProfile | undefined, mappedColumns: ImportedDataset['mappedColumns']) {
  const metricSlot = Object.entries(mappedColumns).find(([, column]) => column === field?.name)?.[0];
  return ['leads', 'valuations', 'sessions', 'bookings'].includes(String(metricSlot))
    ? (metricSlot as 'leads' | 'valuations' | 'sessions' | 'bookings')
    : undefined;
}

function totalsForMetric(rows: MarketingRow[], metricKey: 'leads' | 'valuations' | 'sessions' | 'bookings') {
  return rows.reduce((total, row) => total + row[metricKey], 0);
}

function periodTotals(rows: MarketingRow[], metricKey: 'leads' | 'valuations' | 'sessions' | 'bookings') {
  return Array.from(
    rows
      .reduce((groups, row) => {
        const key = `${row.year}-${String(row.monthIndex).padStart(2, '0')}`;
        const current = groups.get(key) || { key, label: `${row.month} ${row.year}`, value: 0, monthIndex: row.monthIndex, year: row.year };
        current.value += row[metricKey];
        groups.set(key, current);
        return groups;
      }, new Map<string, { key: string; label: string; value: number; monthIndex: number; year: number }>())
      .values(),
  ).sort((a, b) => a.year - b.year || a.monthIndex - b.monthIndex);
}

function categoryTotals(rows: MarketingRow[], dimension: 'brand' | 'channel', metricKey: 'leads' | 'valuations' | 'sessions' | 'bookings') {
  return Array.from(
    rows
      .reduce((groups, row) => {
        const key = String(row[dimension] || 'Uncategorised');
        groups.set(key, (groups.get(key) || 0) + row[metricKey]);
        return groups;
      }, new Map<string, number>())
      .entries(),
  )
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function median(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildInsightNarrative({
  fields,
  kpiFields,
  mappedColumns,
  processedRows,
}: {
  fields: DataFieldProfile[];
  kpiFields: DataFieldProfile[];
  mappedColumns: ImportedDataset['mappedColumns'];
  processedRows: MarketingRow[];
}) {
  const primaryField = kpiFields[0];
  const secondaryField = kpiFields[1];
  const primaryMetric = metricKeyForField(primaryField, mappedColumns);
  const secondaryMetric = metricKeyForField(secondaryField, mappedColumns);
  const insights: string[] = [];
  const caveats: string[] = [];

  if (primaryField && primaryMetric) {
    const total = totalsForMetric(processedRows, primaryMetric);
    insights.push(`${primaryField.label} is the main KPI candidate with ${formatBriefNumber(total)} total across the connected rows.`);

    const periods = periodTotals(processedRows, primaryMetric);
    if (periods.length >= 2) {
      const first = periods[0];
      const last = periods[periods.length - 1];
      const change = first.value ? ((last.value - first.value) / first.value) * 100 : 0;
      insights.push(`${primaryField.label} moved from ${formatBriefNumber(first.value)} in ${first.label} to ${formatBriefNumber(last.value)} in ${last.label} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%).`);
    }

    const dimension = mappedColumns.channel ? 'channel' : mappedColumns.brand ? 'brand' : undefined;
    if (dimension) {
      const ranked = categoryTotals(processedRows, dimension, primaryMetric);
      if (ranked[0]) {
        const bottom = ranked[ranked.length - 1];
        insights.push(`${ranked[0].label} is the top ${dimension} for ${primaryField.label} at ${formatBriefNumber(ranked[0].value)}${bottom ? `, compared with ${formatBriefNumber(bottom.value)} for ${bottom.label}` : ''}.`);
      }
    }

    const values = processedRows.map((row) => row[primaryMetric]).filter((value) => value > 0);
    if (values.length) {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      insights.push(`${primaryField.label} has an average row value of ${formatBriefNumber(mean)} and a median of ${formatBriefNumber(median(values))}, showing the spread behind the total.`);
    }
  }

  if (primaryField && primaryMetric && secondaryField && secondaryMetric) {
    const primaryTotal = totalsForMetric(processedRows, primaryMetric);
    const secondaryTotal = totalsForMetric(processedRows, secondaryMetric);
    if (primaryTotal) {
      insights.push(`${secondaryField.label} runs at ${((secondaryTotal / primaryTotal) * 100).toFixed(1)}% of ${primaryField.label}, useful as an efficiency or mix check.`);
    }
  }

  fields
    .filter((field) => field.role === 'identifier')
    .slice(0, 3)
    .forEach((field) => caveats.push(`${field.label} appears to be an ID/key and is excluded from KPI totals and chart measures.`));

  if (!mappedColumns.date && !mappedColumns.month && !mappedColumns.year) {
    caveats.push('No reliable date field was detected, so trend and period-over-period analysis are limited.');
  }

  if (!kpiFields.length) {
    caveats.push('No strong numeric KPI candidate was detected. The dashboard should remain a data inspection view until measures are defined.');
  }

  return {
    insights: insights.slice(0, 7),
    caveats,
  };
}

function createAnalystBrief({
  fields,
  fileName,
  grain,
  mappedColumns,
  processedRows,
  sourceType,
  timeRange,
}: {
  fields: DataFieldProfile[];
  fileName: string;
  grain: string;
  mappedColumns: ImportedDataset['mappedColumns'];
  processedRows: MarketingRow[];
  sourceType: ImportedDataset['sourceType'];
  timeRange?: DashboardDataContext['timeRange'];
}): AnalystBrief {
  const kpiFields = fields
    .filter(shouldUseAsKpi)
    .sort((a, b) => {
      const score = (field: DataFieldProfile) => {
        const name = normaliseHeader(field.name);
        return (
          (field.role === 'currency' ? 5 : 0) +
          (field.role === 'measure' ? 4 : 0) +
          (field.role === 'percentage' ? 2 : 0) +
          (/\b(revenue|sales|profit|sessions|users|orders|cost|amount|units|quantity)\b/.test(name) ? 4 : 0) -
          (/\b(discount|tax|latitude|longitude)\b/.test(name) ? 3 : 0)
        );
      };

      return score(b) - score(a);
    })
    .slice(0, 5);
  const dateField = fields.find((field) => field.name === mappedColumns.date || field.name === mappedColumns.month);
  const filterFields = fields
    .filter((field) => field.role === 'dimension' && field.distinctValues > 1 && field.distinctValues <= 50)
    .slice(0, 4);
  const warnings = fields
    .filter((field) => field.role === 'identifier')
    .slice(0, 5)
    .map((field) => `${field.label} looks like an ID/key, so it should be used for detail lookup or distinct counts, not summed with K/M/B units.`);

  if (fields.some((field) => field.role === 'percentage')) {
    warnings.push('Percentage/rate fields are non-additive. Recalculate from numerator and denominator when available; otherwise use averages carefully.');
  }

  if (!kpiFields.length) {
    warnings.push('No reliable numeric KPI fields were detected, so the dashboard should focus on data inspection until measures are defined.');
  }
  const narrative = buildInsightNarrative({ fields, kpiFields, mappedColumns, processedRows });
  const dashboardPlan = [
    kpiFields.length
      ? `Top-left: primary KPI card for ${kpiFields[0].label}, because it is the most decision-critical measure detected.`
      : 'Top-left: data quality/source status until a reliable KPI is defined.',
    dateField && kpiFields[0]
      ? `Top-right/middle: ${kpiFields[0].label} trend over ${dateField.label}, because time movement explains whether performance is improving or declining.`
      : 'Trend section omitted unless a reliable date field exists.',
    filterFields[0] && kpiFields[0]
      ? `Middle: sorted ${kpiFields[0].label} ranking by ${filterFields[0].label}, because it identifies the strongest and weakest driver.`
      : 'Driver section uses the first useful category only when one is detected.',
    filterFields[1] && kpiFields[0]
      ? `Middle/right: secondary breakdown by ${filterFields[1].label}, kept separate from the primary ranking to avoid mixing questions.`
      : 'Secondary breakdown omitted unless a second useful category exists.',
    'Bottom: detail table and data model view for exact records, QA, and high-cardinality fields.',
  ];

  return {
    domain: inferDomain(fields.map((field) => field.name), fileName),
    grain,
    businessQuestion: 'Assumption: identify current performance, key drivers, trends, outliers and records needing follow-up.',
    audience: 'Assumption: business users and analysts who need a quick executive view plus drill-down detail.',
    kpis: kpiFields.map((field) => ({
      label: field.label,
      sourceColumn: field.name,
      formula: formulaForField(field),
      aggregation: aggregationForRole(field),
      role: field.role,
      reason:
        field.role === 'percentage'
          ? 'Useful as an efficiency/quality indicator, but must not be summed.'
          : 'Useful as a top-line additive measure for performance monitoring.',
    })),
    comparisons: [
      dateField ? `Trend over time by ${dateField.label}, grouped to the detected period frequency.` : 'No reliable date field detected, so time trend visuals should be omitted.',
      filterFields[0] && kpiFields[0] ? `${kpiFields[0].label} by ${filterFields[0].label}, sorted highest to lowest.` : 'Category comparison depends on a low-cardinality dimension and a reliable measure.',
      filterFields[1] && kpiFields[0] ? `${kpiFields[0].label} by ${filterFields[1].label}, used as a secondary driver view.` : 'Secondary breakdown omitted unless another useful category exists.',
    ].filter(Boolean),
    filters: [
      dateField?.label,
      ...filterFields.map((field) => field.label),
    ].filter((value): value is string => Boolean(value)),
    warnings,
    anomalies: detectAnalystAnomalies(processedRows, kpiFields, mappedColumns),
    keyInsights: narrative.insights,
    dashboardPlan,
    caveats: narrative.caveats.length ? narrative.caveats : ['No major caveats detected from the available schema, but calculated rates still depend on source grain.'],
    layout: [
      'Header: source, row count, detected grain, time range and global filters.',
      'Row 1: 3-5 KPI cards using only valid measure fields.',
      'Row 2: trend and main driver breakdowns, only where matching date/category fields exist.',
      'Row 3: diagnostic tables for high-cardinality detail and QA.',
    ],
  };
}

function detectAnalystAnomalies(rows: MarketingRow[], kpiFields: DataFieldProfile[], mappedColumns: ImportedDataset['mappedColumns']) {
  if (rows.length < 4 || !kpiFields.length || (!mappedColumns.date && !mappedColumns.month && !mappedColumns.year)) {
    return [];
  }

  const metricSlot = Object.entries(mappedColumns).find(([, column]) => column === kpiFields[0]?.name)?.[0] as
    | keyof ImportedDataset['mappedColumns']
    | undefined;
  const metricKey = ['leads', 'valuations', 'sessions', 'bookings'].includes(String(metricSlot)) ? (metricSlot as 'leads' | 'valuations' | 'sessions' | 'bookings') : 'leads';
  const monthlyTotals = Array.from(
    rows
      .reduce((groups, row) => {
        const key = `${row.year}-${String(row.monthIndex).padStart(2, '0')}`;
        const current = groups.get(key) || { label: `${row.month} ${row.year}`, value: 0 };
        current.value += row[metricKey];
        groups.set(key, current);
        return groups;
      }, new Map<string, { label: string; value: number }>())
      .values(),
  );

  if (monthlyTotals.length < 4) {
    return [];
  }

  const values = monthlyTotals.map((item) => item.value);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  const standardDeviation = Math.sqrt(variance);

  if (!standardDeviation) {
    return [];
  }

  return monthlyTotals
    .map((item) => ({ ...item, zScore: (item.value - average) / standardDeviation }))
    .filter((item) => Math.abs(item.zScore) >= 1.8)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
    .slice(0, 3)
    .map((item) => `${item.label} is ${item.zScore > 0 ? 'above' : 'below'} the usual range for ${kpiFields[0].label}.`);
}

function isCostLikeColumn(column: string | undefined) {
  if (!column) {
    return false;
  }

  const normalised = normaliseHeader(column);
  return /\b(cost|expense|spend|budget)\b/.test(normalised);
}

function isPercentageLikeColumn(column: string) {
  const normalised = normaliseHeader(column);
  return /\b(rate|percent|percentage|pct|conversion|margin|discount)\b/.test(normalised);
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
      const shouldDeriveProfit = !bookingsColumn && isCurrencyLikeColumn(leadsColumn) && isCostLikeColumn(valuationsColumn);
      const bookings = bookingsColumn
        ? toNumber(row[bookingsColumn])
        : shouldDeriveProfit
          ? Math.max(0, leads - valuations)
          : Math.round(Math.max(valuations * 0.22, leads * 0.08));

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

export function createDataContext({
  columns,
  fileName,
  mappedColumns,
  processedRowCount,
  rawRowCount,
  rawRows,
  processedRows = [],
  sourceType,
}: {
  columns: string[];
  fileName: string;
  mappedColumns: ImportedDataset['mappedColumns'];
  processedRowCount: number;
  rawRowCount: number;
  rawRows: RawRow[];
  processedRows?: MarketingRow[];
  sourceType: ImportedDataset['sourceType'];
}): DashboardDataContext {
  const mappedEntries = Object.entries(mappedColumns).reduce<Record<string, keyof ImportedDataset['mappedColumns']>>(
    (entries, [slot, column]) => {
      if (column) {
        entries[column] = slot as keyof ImportedDataset['mappedColumns'];
      }

      return entries;
    },
    {},
  );

  const fields = columns.map((column) => {
    const sampleValues = Array.from(
      new Set(
        rawRows
          .map((row) => String(row[column] ?? '').trim())
          .filter(Boolean)
          .slice(0, 20),
      ),
    ).slice(0, 3);
    const mappedTo = mappedEntries[column];
    const role: DataFieldRole = isIdentifierColumn(column)
      ? 'identifier'
      : isDateLikeColumn(column) || ['date', 'month', 'year'].includes(String(mappedTo))
        ? 'date'
        : isPercentageLikeColumn(column)
          ? 'percentage'
          : isCurrencyLikeColumn(column)
            ? 'currency'
            : ['brand', 'channel'].includes(String(mappedTo))
              ? 'dimension'
              : findNumericColumns(rawRows, [column]).length
                ? 'measure'
                : 'unknown';

    return {
      name: column,
      label: cleanFieldLabel(column),
      role,
      mappedTo,
      distinctValues: distinctCount(rawRows, column),
      sampleValues,
    };
  });
  const grain = inferGrain(columns, mappedColumns);
  const timeRange = inferTimeRange(processedRows, mappedColumns);

  return {
    sourceName: fileName,
    sourceType,
    rawRowCount,
    processedRowCount,
    rawRows,
    grain,
    timeRange,
    fields,
    metricSlots: {
      leads: mappedColumns.leads,
      valuations: mappedColumns.valuations,
      sessions: mappedColumns.sessions,
      bookings: mappedColumns.bookings,
    },
    dimensionSlots: {
      date: mappedColumns.date || mappedColumns.month,
      primary: mappedColumns.brand,
      secondary: mappedColumns.channel,
    },
    analystBrief: createAnalystBrief({
      fields,
      fileName,
      grain,
      mappedColumns,
      processedRows,
      sourceType,
      timeRange,
    }),
  };
}

function inferGrain(columns: string[], mappedColumns: ImportedDataset['mappedColumns']) {
  const idColumn = columns.find(isIdentifierColumn);
  const dateColumn = mappedColumns.date || mappedColumns.month;
  const primaryDimension = mappedColumns.brand;
  const secondaryDimension = mappedColumns.channel;
  const parts = [
    idColumn ? `one record/transaction identified by ${cleanFieldLabel(idColumn)}` : 'one source row or event record',
    dateColumn ? `at ${cleanFieldLabel(dateColumn)} level` : null,
    primaryDimension ? `split by ${cleanFieldLabel(primaryDimension)}` : null,
    secondaryDimension ? `and ${cleanFieldLabel(secondaryDimension)}` : null,
  ].filter(Boolean);

  return parts.join(' ');
}

function inferTimeRange(rows: MarketingRow[], mappedColumns: ImportedDataset['mappedColumns']) {
  const datedRows = rows
    .map((row) => row.date)
    .filter(Boolean)
    .sort();

  if (!datedRows.length || (!mappedColumns.date && !mappedColumns.month && !mappedColumns.year)) {
    return {
      label: 'No reliable date field detected',
      frequency: 'Not detected',
    };
  }

  const distinctMonths = new Set(rows.map((row) => `${row.year}-${String(row.monthIndex).padStart(2, '0')}`)).size;
  const distinctYears = new Set(rows.map((row) => row.year)).size;

  return {
    label: `${datedRows[0]} to ${datedRows[datedRows.length - 1]}`,
    frequency: distinctMonths > distinctYears ? 'Monthly/periodic' : 'Yearly or low-frequency',
    start: datedRows[0],
    end: datedRows[datedRows.length - 1],
  };
}

function cleanFieldLabel(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    dataContext: createDataContext({
      columns,
      fileName: file.name,
      mappedColumns,
      processedRowCount: rows.length,
      processedRows: rows,
      rawRowCount: rawRows.length,
      rawRows: limitedRawRows,
      sourceType: isExcel ? 'excel' : 'csv',
    }),
  };
}
