'use client';

import { Filter } from 'lucide-react';
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
    <Card className="border-slate-200/80 bg-card shadow-none">
      <CardContent className="flex flex-wrap items-end gap-2 p-3">
        <div className="flex h-10 items-center gap-2 rounded-full border border-border bg-muted px-3 text-xs font-semibold text-muted-foreground">
          <Filter className="h-4 w-4 text-primary" />
          Slicers
        </div>

        <label className="grid min-w-[170px] gap-1 text-xs font-medium text-muted-foreground">
          <span className="px-2">Brand</span>
          <select
            className="h-10 rounded-full border border-slate-200 bg-card px-4 text-sm font-medium text-slate-900 outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={filters.brand}
            onChange={(event) => updateFilter('brand', event.target.value)}
          >
            <option>All</option>
            {brands.map((brand) => <option key={brand}>{brand}</option>)}
          </select>
        </label>

        <label className="grid min-w-[170px] gap-1 text-xs font-medium text-muted-foreground">
          <span className="px-2">Channel</span>
          <select
            className="h-10 rounded-full border border-slate-200 bg-card px-4 text-sm font-medium text-slate-900 outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={filters.channel}
            onChange={(event) => updateFilter('channel', event.target.value)}
          >
            <option>All</option>
            {channels.map((channel) => <option key={channel}>{channel}</option>)}
          </select>
        </label>

        <label className="grid min-w-[140px] gap-1 text-xs font-medium text-muted-foreground">
          <span className="px-2">Start Month</span>
          <select
            className="h-10 rounded-full border border-slate-200 bg-card px-4 text-sm font-medium text-slate-900 outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={filters.startMonth}
            onChange={(event) => updateFilter('startMonth', Number(event.target.value))}
          >
            {monthOptions.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
          </select>
        </label>

        <label className="grid min-w-[140px] gap-1 text-xs font-medium text-muted-foreground">
          <span className="px-2">End Month</span>
          <select
            className="h-10 rounded-full border border-slate-200 bg-card px-4 text-sm font-medium text-slate-900 outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={filters.endMonth}
            onChange={(event) => updateFilter('endMonth', Number(event.target.value))}
          >
            {monthOptions.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
          </select>
        </label>

        <Button
          className="h-10 rounded-full"
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
