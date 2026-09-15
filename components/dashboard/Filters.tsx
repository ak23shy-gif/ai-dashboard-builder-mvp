'use client';

import type { DashboardFilters } from '@/lib/data/dataProcessor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type FiltersProps = {
  filters: DashboardFilters;
  brands: string[];
  channels: string[];
  onChange: (filters: DashboardFilters) => void;
};

export function Filters({ brands, channels, filters, onChange }: FiltersProps) {
  function updateFilter<K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <Card className="border-slate-200/80 bg-white shadow-none">
      <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end">
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Brand
          <select
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={filters.brand}
            onChange={(event) => updateFilter('brand', event.target.value)}
          >
            <option>All</option>
            {brands.map((brand) => <option key={brand}>{brand}</option>)}
          </select>
        </label>

        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Channel
          <select
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={filters.channel}
            onChange={(event) => updateFilter('channel', event.target.value)}
          >
            <option>All</option>
            {channels.map((channel) => <option key={channel}>{channel}</option>)}
          </select>
        </label>

        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Start Month
          <select
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={filters.startMonth}
            onChange={(event) => updateFilter('startMonth', Number(event.target.value))}
          >
            {monthOptions.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
          </select>
        </label>

        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          End Month
          <select
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={filters.endMonth}
            onChange={(event) => updateFilter('endMonth', Number(event.target.value))}
          >
            {monthOptions.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
          </select>
        </label>

        <Button
          variant="outline"
          onClick={() => onChange({ brand: 'All', channel: 'All', startMonth: 1, endMonth: 12 })}
        >
          Reset
        </Button>
      </CardContent>
    </Card>
  );
}

const monthOptions = [
  { label: 'Jan', value: 1 },
  { label: 'Feb', value: 2 },
  { label: 'Mar', value: 3 },
  { label: 'Apr', value: 4 },
  { label: 'May', value: 5 },
  { label: 'Jun', value: 6 },
  { label: 'Jul', value: 7 },
  { label: 'Aug', value: 8 },
  { label: 'Sep', value: 9 },
  { label: 'Oct', value: 10 },
  { label: 'Nov', value: 11 },
  { label: 'Dec', value: 12 },
];
