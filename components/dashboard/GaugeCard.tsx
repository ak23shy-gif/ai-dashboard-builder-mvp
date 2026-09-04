'use client';

import { RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCompactNumber, type KpiSummary } from '@/lib/data/dataProcessor';
import type { DashboardMetric } from '@/types/dashboard';

type GaugeCardProps = {
  title: string;
  metric: DashboardMetric;
  summary: KpiSummary;
  target?: number;
};

export function GaugeCard({ metric, summary, target, title }: GaugeCardProps) {
  const value = metric === 'conversionRate' ? summary.conversionRate : summary[metric];
  const gaugeTarget = target || (metric === 'conversionRate' ? 100 : Math.max(value, 1));
  const percentage = Math.min(Math.round((value / gaugeTarget) * 100), 100);

  return (
    <Card className="min-w-0 overflow-hidden border-slate-200/80 shadow-none transition hover:border-primary/25 hover:shadow-md">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart cx="50%" cy="62%" innerRadius="68%" outerRadius="100%" data={[{ value: percentage }]} startAngle={180} endAngle={0}>
              <RadialBar background dataKey="value" fill="#1f7a8c" cornerRadius={8} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-x-0 bottom-8 text-center">
            <p className="text-3xl font-semibold text-slate-950">{metric === 'conversionRate' ? `${value}%` : formatCompactNumber(value)}</p>
            <p className="mt-1 text-xs text-slate-500">{percentage}% of reference target</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
