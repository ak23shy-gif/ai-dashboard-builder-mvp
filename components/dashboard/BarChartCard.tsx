'use client';

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCompactNumber } from '@/lib/data/dataProcessor';

type BarChartCardProps = {
  title: string;
  data: Array<Record<string, string | number>>;
  xKey: string;
  yKey: string;
  color?: string;
};

export function BarChartCard({ title, data, xKey, yKey, color = '#1f7a8c' }: BarChartCardProps) {
  const safeData = data
    .filter((row) => typeof row[yKey] === 'number' && Number.isFinite(row[yKey] as number))
    .slice(0, 20);

  return (
    <Card className="min-w-0 overflow-hidden border-slate-200/80 shadow-none transition hover:border-primary/25 hover:shadow-md">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[260px]">
          {safeData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={safeData} margin={{ left: -8, right: 12, top: 22, bottom: 0 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey={xKey} tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={(value) => formatCompactNumber(Number(value))} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip formatter={(value) => formatCompactNumber(Number(value))} />
                <Bar dataKey={yKey} fill={color} radius={[6, 6, 0, 0]}>
                  <LabelList
                    dataKey={yKey}
                    fill="hsl(var(--foreground))"
                    fontSize={11}
                    formatter={(value: unknown) => formatCompactNumber(Number(value))}
                    position="top"
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
