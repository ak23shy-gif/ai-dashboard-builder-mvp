'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDashboardValue } from '@/lib/data/dataProcessor';

const colors = ['#1f7a8c', '#d88c36', '#4f7f52', '#7c3aed', '#c9463d', '#64748b'];

type PieChartCardProps = {
  title: string;
  data: Array<Record<string, string | number>>;
  nameKey: string;
  valueKey: string;
  valueLabel?: string;
};

export function PieChartCard({ title, data, nameKey, valueKey, valueLabel }: PieChartCardProps) {
  const safeData = data.filter(
    (row) => typeof row[valueKey] === 'number' && Number.isFinite(row[valueKey] as number) && Number(row[valueKey]) > 0,
  ).slice(0, 8);
  const total = safeData.reduce((sum, row) => sum + Number(row[valueKey]), 0);

  return (
    <Card className="min-w-0 overflow-hidden border-slate-200/80 shadow-none transition hover:border-primary/25 hover:shadow-md">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(150px,190px)_minmax(0,1fr)]">
          <div className="h-[210px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {safeData.length ? (
                  <Pie
                    cx="50%"
                    cy="50%"
                    data={safeData}
                    dataKey={valueKey}
                    innerRadius={54}
                    outerRadius={82}
                    paddingAngle={3}
                    label={({ value }) => total > 0 ? `${Math.round((Number(value) / total) * 100)}%` : ''}
                    labelLine={false}
                    nameKey={nameKey}
                  >
                    {safeData.map((entry, index) => (
                      <Cell fill={colors[index % colors.length]} key={String(entry[nameKey])} />
                    ))}
                  </Pie>
                ) : null}
                <Tooltip formatter={(value) => formatDashboardValue(Number(value), `${valueKey} ${valueLabel || title}`)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid min-w-0 content-center gap-2">
            {safeData.length ? (
              safeData.map((entry, index) => (
                <div
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-sm"
                  key={String(entry[nameKey])}
                >
                  <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: colors[index % colors.length] }}
                    />
                    <span className="break-words leading-5">{String(entry[nameKey])}</span>
                  </span>
                  <span className="text-right font-medium tabular-nums">
                    {formatDashboardValue(Number(entry[valueKey]), `${valueKey} ${valueLabel || title}`)}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No chart data available</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
