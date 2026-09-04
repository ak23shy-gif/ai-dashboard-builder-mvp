'use client';

import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDashboardValue } from '@/lib/data/dataProcessor';

type LineChartCardProps = {
  title: string;
  data: Array<Record<string, string | number>>;
  xKey: string;
  lines: Array<{ key: string; name: string; color: string }>;
};

export function LineChartCard({ title, data, xKey, lines }: LineChartCardProps) {
  const safeData = data.filter((row) =>
    lines.some((line) => typeof row[line.key] === 'number' && Number.isFinite(row[line.key] as number)),
  );
  const showDataLabels = safeData.length <= 12 && lines.length <= 2;

  function formatLineValue(value: unknown, key?: string) {
    const line = lines.find((item) => item.key === key || item.name === key);
    return formatDashboardValue(Number(value), `${key || ''} ${line?.name || title}`);
  }

  return (
    <Card className="min-w-0 overflow-hidden border-slate-200/80 shadow-none transition hover:border-primary/25 hover:shadow-md">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[260px]">
          {safeData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={safeData} margin={{ left: -8, right: 18, top: 24, bottom: 0 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey={xKey} tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={(value) => formatLineValue(value)} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip formatter={(value, name) => formatLineValue(value, String(name))} />
                {lines.map((line) => (
                  <Line
                    dataKey={line.key}
                    dot={false}
                    key={line.key}
                    name={line.name}
                    stroke={line.color}
                    strokeWidth={2.5}
                    type="monotone"
                    >
                    {showDataLabels && (
                      <LabelList
                        dataKey={line.key}
                        fill="hsl(var(--foreground))"
                        fontSize={11}
                        formatter={(value: unknown) => formatLineValue(value, line.key)}
                        position="top"
                      />
                    )}
                  </Line>
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No chart data available</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
