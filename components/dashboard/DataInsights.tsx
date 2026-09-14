import { AlertTriangle, BarChart3, Layers3, Route } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCompactNumber, type KpiSummary } from '@/lib/data/dataProcessor';
import type { DashboardDataContext } from '@/lib/data/importData';

type DataInsightsProps = {
  dataContext?: DashboardDataContext;
  summary: KpiSummary;
  recordCount: number;
  dimensionCount: number;
};

export function DataInsights({ dataContext, dimensionCount, recordCount, summary }: DataInsightsProps) {
  const brief = dataContext?.analystBrief;
  const insightCards = [
    {
      label: 'Rows analysed',
      value: formatCompactNumber(recordCount),
      detail: `${dimensionCount} usable category values detected`,
      icon: Layers3,
    },
    {
      label: 'Detected data type',
      value: brief?.domain || 'Connected dataset',
      detail: brief?.grain || dataContext?.grain || 'Grain not detected',
      icon: Route,
    },
    {
      label: 'KPI candidates',
      value: brief?.kpis.length ? String(brief.kpis.length) : formatCompactNumber(summary.leads),
      detail: brief?.kpis.length ? brief.kpis.map((kpi) => kpi.label).join(', ') : 'No analyst KPI profile available',
      icon: BarChart3,
    },
    {
      label: 'Model warnings',
      value: brief?.warnings.length ? String(brief.warnings.length) : '0',
      detail: brief?.warnings[0] || 'No obvious ID/rate aggregation issue detected',
      icon: AlertTriangle,
    },
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {insightCards.map((item) => {
        const Icon = item.icon;

        return (
          <Card className="border-slate-200/80 bg-white/80 shadow-none" key={item.label}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-slate-500">{item.label}</p>
                <p className="mt-1 truncate text-lg font-semibold text-slate-950" title={item.value}>
                  {item.value}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500" title={item.detail}>
                  {item.detail}
                </p>
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
