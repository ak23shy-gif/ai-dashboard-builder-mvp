'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Columns3, Database, Hash, Table2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDashboardValue } from '@/lib/data/dataProcessor';
import type { DashboardDataContext } from '@/lib/data/importData';
import type { MarketingRow } from '@/lib/data/mockData';

type ModelRow = Record<string, unknown>;

type DataModelViewProps = {
  rows: MarketingRow[];
  sourceLabel: string;
  dataContext?: DashboardDataContext;
};

const fallbackModelColumns: Array<{ key: keyof MarketingRow; label: string }> = [
  { key: 'date', label: 'Date' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'brand', label: 'Primary dimension' },
  { key: 'channel', label: 'Secondary dimension' },
  { key: 'leads', label: 'Primary volume' },
  { key: 'valuations', label: 'Qualified records' },
  { key: 'sessions', label: 'Activity volume' },
  { key: 'bookings', label: 'Completed outcomes' },
];

function fallbackFieldType(key: keyof MarketingRow) {
  if (key === 'date') {
    return 'date';
  }

  if (['month', 'brand', 'channel'].includes(key)) {
    return 'text';
  }

  return 'number';
}

function missingCount(rows: ModelRow[], key: string) {
  return rows.filter((row) => row[key] === null || row[key] === undefined || row[key] === '').length;
}

function distinctCount(rows: ModelRow[], key: string) {
  return new Set(rows.map((row) => String(row[key] ?? ''))).size;
}

function formatModelCell(value: unknown, context: string) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return String(formatDashboardValue(value, context));
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }

  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function labelForSlot(dataContext: DashboardDataContext | undefined, slot: string, fallback: string) {
  const sourceColumn =
    slot === 'date'
      ? dataContext?.dimensionSlots.date
      : slot === 'brand'
        ? dataContext?.dimensionSlots.primary
        : slot === 'channel'
          ? dataContext?.dimensionSlots.secondary
          : dataContext?.metricSlots[slot as keyof DashboardDataContext['metricSlots']];

  return dataContext?.fields.find((field) => field.name === sourceColumn)?.label || fallback;
}

export function DataModelView({ rows, sourceLabel, dataContext }: DataModelViewProps) {
  const previewCount = 700;
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const tableViewportRef = useRef<HTMLDivElement>(null);
  const bottomScrollbarRef = useRef<HTMLDivElement>(null);
  const displayColumns = useMemo(
    () => {
      if (dataContext?.fields.length) {
        return dataContext.fields.map((field) => ({
          key: field.name,
          label: field.label,
          role: field.role,
        }));
      }

      return fallbackModelColumns.map((column) => ({
        ...column,
        label: labelForSlot(dataContext, column.key, column.label),
        role: fallbackFieldType(column.key),
      }));
    },
    [dataContext],
  );
  const modelRows = useMemo<ModelRow[]>(
    () => (dataContext?.rawRows?.length ? dataContext.rawRows : rows),
    [dataContext?.rawRows, rows],
  );
  const previewRows = modelRows.slice(0, previewCount);
  const tableMinWidth = displayColumns.length * 165;
  const fieldProfiles = useMemo(() => {
    return displayColumns.reduce<Record<string, { distinct: number; missing: number }>>((profiles, column) => {
      profiles[column.key] = {
        distinct: distinctCount(modelRows, column.key),
        missing: missingCount(modelRows, column.key),
      };
      return profiles;
    }, {});
  }, [displayColumns, modelRows]);

  useEffect(() => {
    function updateScrollWidth() {
      setTableScrollWidth(tableViewportRef.current?.scrollWidth || tableMinWidth);
    }

    updateScrollWidth();
    window.addEventListener('resize', updateScrollWidth);

    return () => window.removeEventListener('resize', updateScrollWidth);
  }, [displayColumns.length, previewRows.length, tableMinWidth]);

  function syncTableFromBottomScrollbar() {
    if (tableViewportRef.current && bottomScrollbarRef.current) {
      tableViewportRef.current.scrollLeft = bottomScrollbarRef.current.scrollLeft;
    }
  }

  function syncBottomScrollbarFromTable() {
    if (tableViewportRef.current && bottomScrollbarRef.current) {
      bottomScrollbarRef.current.scrollLeft = tableViewportRef.current.scrollLeft;
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 shadow-none">
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-slate-500">Source</p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-950" title={sourceLabel}>{sourceLabel}</p>
            </div>
            <Database className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-none">
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Rows</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{modelRows.length.toLocaleString('en-GB')}</p>
            </div>
            <Table2 className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-none">
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Fields</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{displayColumns.length}</p>
            </div>
            <Columns3 className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200/80 shadow-none">
        <CardHeader className="border-b border-slate-100">
          <div>
            <CardTitle>Model fields</CardTitle>
            <p className="mt-1 text-xs leading-5 text-slate-500">Fields currently available to the dashboard renderer and AI planner.</p>
          </div>
          <Badge>Schema</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {displayColumns.map((column) => (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3" key={column.key}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-slate-900">{column.label}</p>
                  <Badge>{column.role || 'field'}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <span>Distinct: {fieldProfiles[column.key]?.distinct ?? 0}</span>
                  <span>Missing: {fieldProfiles[column.key]?.missing ?? 0}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 shadow-none">
        <CardHeader className="border-b border-slate-100">
          <div>
            <CardTitle>Data table</CardTitle>
            <p className="mt-1 text-xs leading-5 text-slate-500">Preview of the active dataset, similar to Power BI table view.</p>
          </div>
          <Badge>{previewRows.length.toLocaleString('en-GB')} shown</Badge>
        </CardHeader>
        <CardContent className="min-w-0">
          {modelRows.length ? (
            <div className="grid h-[min(560px,calc(100vh-260px))] min-h-[360px] w-full max-w-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-md border border-slate-200">
              <div
                className="dashboard-scrollbar min-h-0 overflow-y-auto overflow-x-hidden"
                onScroll={syncBottomScrollbarFromTable}
                ref={tableViewportRef}
              >
                <table className="table-fixed text-sm" style={{ width: tableMinWidth }}>
                  <colgroup>
                    {displayColumns.map((column) => (
                      <col key={column.key} style={{ width: 165 }} />
                    ))}
                  </colgroup>
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                      {displayColumns.map((column) => (
                        <th className="whitespace-nowrap px-3 py-3 font-semibold" key={column.key} title={column.label}>
                          <span className="block truncate">{column.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, index) => (
                      <tr className="border-b border-slate-100 transition hover:bg-slate-50 last:border-0" key={index}>
                        {displayColumns.map((column) => {
                          const displayValue = formatModelCell(row[column.key], `${column.key} ${column.label}`);

                          return (
                            <td className="whitespace-nowrap px-3 py-3 text-slate-700" key={column.key} title={String(displayValue)}>
                              <span className="block truncate">{displayValue}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                className="dashboard-scrollbar h-5 overflow-x-scroll overflow-y-hidden border-t border-slate-200 bg-slate-50"
                onScroll={syncTableFromBottomScrollbar}
                ref={bottomScrollbarRef}
              >
                <div className="h-1" style={{ width: tableScrollWidth || tableMinWidth }} />
              </div>
            </div>
          ) : (
            <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
              Upload a CSV or Excel file to inspect the model table.
            </div>
          )}
          {modelRows.length > previewRows.length && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <Hash className="h-4 w-4" />
              Showing first {previewRows.length.toLocaleString('en-GB')} rows for browser performance.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
