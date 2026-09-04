'use client';

import { useMemo, useState } from 'react';
import { Columns3, Database, Hash, MoveHorizontal, Rows3, Table2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDashboardValue } from '@/lib/data/dataProcessor';
import type { MarketingRow } from '@/lib/data/mockData';

type DataModelViewProps = {
  rows: MarketingRow[];
  sourceLabel: string;
};

const modelColumns: Array<{ key: keyof MarketingRow; label: string }> = [
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

function fieldType(key: keyof MarketingRow) {
  if (key === 'date') {
    return 'date';
  }

  if (['month', 'brand', 'channel'].includes(key)) {
    return 'text';
  }

  return 'number';
}

function missingCount(rows: MarketingRow[], key: keyof MarketingRow) {
  return rows.filter((row) => row[key] === null || row[key] === undefined || row[key] === '').length;
}

function distinctCount(rows: MarketingRow[], key: keyof MarketingRow) {
  return new Set(rows.map((row) => String(row[key] ?? ''))).size;
}

export function DataModelView({ rows, sourceLabel }: DataModelViewProps) {
  const [previewCount, setPreviewCount] = useState(250);
  const previewRows = rows.slice(0, previewCount);
  const tableMinWidth = modelColumns.length * 165;
  const fieldProfiles = useMemo(() => {
    return modelColumns.reduce<Record<string, { distinct: number; missing: number }>>((profiles, column) => {
      profiles[column.key] = {
        distinct: distinctCount(rows, column.key),
        missing: missingCount(rows, column.key),
      };
      return profiles;
    }, {});
  }, [rows]);

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 shadow-none">
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Source</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{sourceLabel}</p>
            </div>
            <Database className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-none">
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Rows</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{rows.length.toLocaleString('en-GB')}</p>
            </div>
            <Table2 className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-none">
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Fields</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{modelColumns.length}</p>
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
            {modelColumns.map((column) => (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3" key={column.key}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-slate-900">{column.label}</p>
                  <Badge>{fieldType(column.key)}</Badge>
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
        <CardContent>
          {rows.length ? (
            <>
              <div className="mb-4 grid gap-3 rounded-md border border-border bg-muted p-3">
                <label className="grid gap-2 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <Rows3 className="h-4 w-4" />
                    Rows shown: {previewCount.toLocaleString('en-GB')}
                  </span>
                  <input
                    className="accent-primary"
                    max={Math.min(rows.length, 1000)}
                    min={50}
                    onChange={(event) => setPreviewCount(Number(event.target.value))}
                    step={50}
                    type="range"
                    value={Math.min(previewCount, Math.min(rows.length, 1000))}
                  />
                </label>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MoveHorizontal className="h-4 w-4" />
                  Use the horizontal scrollbar at the bottom of the table to view hidden right-side columns.
                </p>
              </div>

              <div className="max-h-[560px] overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-sm" style={{ minWidth: tableMinWidth }}>
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    {modelColumns.map((column) => (
                      <th className="whitespace-nowrap px-3 py-3 font-semibold" key={column.key}>
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr className="border-b border-slate-100 transition hover:bg-slate-50 last:border-0" key={`${row.date}-${row.brand}-${row.channel}-${index}`}>
                      {modelColumns.map((column) => (
                        <td className="whitespace-nowrap px-3 py-3 text-slate-700" key={column.key}>
                          {formatDashboardValue(row[column.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          ) : (
            <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
              Upload a CSV or Excel file to inspect the model table.
            </div>
          )}
          {rows.length > previewRows.length && (
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
