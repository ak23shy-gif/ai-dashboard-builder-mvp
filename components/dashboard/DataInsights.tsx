import { Activity, Layers3, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCompactNumber, type KpiSummary } from '@/lib/data/dataProcessor';

type DataInsightsProps = {
  summary: KpiSummary;
  recordCount: number;
  dimensionCount: number;
};

export function DataInsights({ dimensionCount, recordCount, summary }: DataInsightsProps) {
  const insightCards = [
    {
      label: 'Rows analysed',
      value: formatCompactNumber(recordCount),
      icon: Layers3,
    },
    {
      label: 'Primary volume',
      value: formatCompactNumber(summary.leads),
      icon: Activity,
    },
    {
      label: 'Conversion ratio',
      value: `${summary.conversionRate}%`,
      icon: TrendingUp,
    },
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {insightCards.map((item) => {
        const Icon = item.icon;

        return (
          <Card className="border-slate-200/80 bg-white/80 shadow-none" key={item.label}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-slate-500">{item.label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">{item.value}</p>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-primary">
                <Icon className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        );
      })}
      <p className="sr-only">{dimensionCount} dimensions detected.</p>
    </div>
  );
}
