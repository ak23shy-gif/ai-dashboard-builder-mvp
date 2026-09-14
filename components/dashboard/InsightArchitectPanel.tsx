import { AlertCircle, ClipboardList, Lightbulb } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { DashboardDataContext } from '@/lib/data/importData';

type InsightArchitectPanelProps = {
  dataContext?: DashboardDataContext;
};

function PanelList({
  icon: Icon,
  items,
  title,
}: {
  icon: typeof Lightbulb;
  items: string[];
  title: string;
}) {
  return (
    <Card className="border-slate-200/80 bg-white shadow-none">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
        </div>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
          {items.map((item) => (
            <li className="flex gap-2" key={item}>
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function InsightArchitectPanel({ dataContext }: InsightArchitectPanelProps) {
  const brief = dataContext?.analystBrief;

  if (!brief) {
    return null;
  }

  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <PanelList
        icon={Lightbulb}
        items={brief.keyInsights.length ? brief.keyInsights : ['Connect a dataset with numeric measures to generate ranked, evidence-backed insights.']}
        title="Key Insights"
      />
      <PanelList
        icon={ClipboardList}
        items={brief.dashboardPlan.length ? brief.dashboardPlan : brief.layout}
        title="Dashboard Plan"
      />
      <PanelList
        icon={AlertCircle}
        items={[...brief.caveats, ...brief.warnings.slice(0, 2), ...brief.anomalies.slice(0, 2)].filter(Boolean).slice(0, 5)}
        title="Caveats"
      />
    </section>
  );
}
