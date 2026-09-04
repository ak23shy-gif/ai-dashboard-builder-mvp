import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCompactNumber } from '@/lib/data/dataProcessor';
import type { DashboardMetric } from '@/types/dashboard';

type HeatmapCardProps = {
  title: string;
  data: Array<Record<string, string | number>>;
  metrics: Array<Exclude<DashboardMetric, 'conversionRate'>>;
};

const metricLabels = {
  leads: 'Primary',
  valuations: 'Qualified',
  sessions: 'Activity',
  bookings: 'Outcomes',
};

export function HeatmapCard({ data, metrics, title }: HeatmapCardProps) {
  const maxValue = Math.max(
    ...data.flatMap((row) => metrics.map((metric) => Number(row[metric]) || 0)),
    1,
  );

  return (
    <Card className="min-w-0 overflow-hidden border-slate-200/80 shadow-none transition hover:border-primary/25 hover:shadow-md">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] gap-2" style={{ gridTemplateColumns: `110px repeat(${data.length}, minmax(44px, 1fr))` }}>
            <div />
            {data.map((row) => (
              <div className="text-center text-xs font-medium text-slate-500" key={String(row.month)}>
                {row.month}
              </div>
            ))}
            {metrics.map((metric) => (
              <div className="contents" key={metric}>
                <div className="flex items-center text-xs font-semibold text-slate-600">{metricLabels[metric]}</div>
                {data.map((row) => {
                  const value = Number(row[metric]) || 0;
                  const intensity = Math.max(value / maxValue, 0.08);

                  return (
                    <div
                      className="flex h-10 items-center justify-center rounded-md text-xs font-semibold text-slate-950"
                      key={`${metric}-${row.month}`}
                      style={{ backgroundColor: `rgba(31, 122, 140, ${intensity})` }}
                      title={`${metricLabels[metric]}: ${formatCompactNumber(value)}`}
                    >
                      {formatCompactNumber(value)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
