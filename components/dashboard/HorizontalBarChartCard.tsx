'use client';

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDashboardValue } from '@/lib/data/dataProcessor';

type HorizontalBarChartCardProps = {
  title: string;
  data: Array<Record<string, string | number>>;
  xKey: string;
  yKey: string;
  color?: string;
  valueLabel?: string;
};

export function HorizontalBarChartCard({ color = '#1f7a8c', data, title, xKey, yKey, valueLabel }: HorizontalBarChartCardProps) {
  const safeData = data.filter((row) => typeof row[xKey] === 'number' && Number.isFinite(row[xKey] as number)).slice(0, 8);

  return (
    <Card className="min-w-0 overflow-hidden border-slate-200/80 shadow-none transition hover:border-primary/25 hover:shadow-md">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">
          {safeData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={safeData} layout="vertical" margin={{ left: 12, right: 54, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                <XAxis tickFormatter={(value) => formatDashboardValue(Number(value), `${xKey} ${valueLabel || title}`)} type="number" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis dataKey={yKey} type="category" width={110} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip formatter={(value) => formatDashboardValue(Number(value), `${xKey} ${valueLabel || title}`)} />
                <Bar dataKey={xKey} fill={color} radius={[0, 6, 6, 0]}>
                  <LabelList
                    dataKey={xKey}
                    fill="hsl(var(--foreground))"
                    fontSize={11}
                    formatter={(value: unknown) => formatDashboardValue(Number(value), `${xKey} ${valueLabel || title}`)}
                    position="right"
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No chart data available</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
