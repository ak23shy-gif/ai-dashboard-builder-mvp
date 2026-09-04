import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCompactNumber, type KpiSummary } from '@/lib/data/dataProcessor';
import type { DashboardMetric } from '@/types/dashboard';

type FunnelChartCardProps = {
  title: string;
  summary: KpiSummary;
  stages: Array<{ metric: Exclude<DashboardMetric, 'conversionRate'>; label: string; color: string }>;
};

export function FunnelChartCard({ stages, summary, title }: FunnelChartCardProps) {
  const values = stages.map((stage) => ({ ...stage, value: summary[stage.metric] }));
  const maxValue = Math.max(...values.map((stage) => stage.value), 1);

  return (
    <Card className="min-w-0 overflow-hidden border-slate-200/80 shadow-none transition hover:border-primary/25 hover:shadow-md">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {values.map((stage, index) => {
            const width = Math.max((stage.value / maxValue) * 100, 8);

            return (
              <div className="grid gap-1.5" key={stage.metric}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-slate-600">{stage.label}</span>
                  <span className="font-semibold tabular-nums text-slate-950">{formatCompactNumber(stage.value)}</span>
                </div>
                <div className="h-8 rounded-md bg-slate-100">
                  <div
                    className="flex h-8 items-center rounded-md px-3 text-xs font-semibold text-white transition-all"
                    style={{ backgroundColor: stage.color, width: `${width}%`, opacity: 1 - index * 0.08 }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
