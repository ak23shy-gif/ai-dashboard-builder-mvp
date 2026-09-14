'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Database, Search, Settings, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataInsights } from '@/components/dashboard/DataInsights';
import { DataModelView } from '@/components/dashboard/DataModelView';
import { DashboardRenderer } from '@/components/dashboard/DashboardRenderer';
import { Filters } from '@/components/dashboard/Filters';
import { InsightArchitectPanel } from '@/components/dashboard/InsightArchitectPanel';
import type { MarketingRow } from '@/lib/data/mockData';
import type { DashboardDataContext } from '@/lib/data/importData';
import {
  filterMarketingData,
  groupByBrand,
  groupByChannel,
  groupByMonth,
  summarizeMarketingData,
  topDimensionValues,
  type DashboardFilters,
} from '@/lib/data/dataProcessor';
import type { DashboardComponentConfig, DashboardConfig } from '@/types/dashboard';

const defaultFilters: DashboardFilters = {
  brand: 'All',
  channel: 'All',
  startMonth: 1,
  endMonth: 12,
};

function compactDashboardTitle(title: string) {
  if (/^https?:\/\//i.test(title) || title.length > 72) {
    return 'Connected Data Dashboard';
  }

  return title;
}

function compactDashboardDescription(description: string | undefined) {
  if (!description) {
    return '';
  }

  const cleaned = description.replace(/\s+/g, ' ').trim();
  return cleaned.length > 220 ? `${cleaned.slice(0, 217).trim()}...` : cleaned;
}

type DashboardCanvasProps = {
  dashboardConfig: DashboardConfig;
  dataContext?: DashboardDataContext;
  renderVersion: number;
  rows: MarketingRow[];
  sourceLabel: string;
  onChangeChartType: (componentId: string) => void;
  onDeleteComponent: (componentId: string) => void;
  onUpdateComponent: (componentId: string, updater: (component: DashboardComponentConfig) => DashboardComponentConfig) => void;
};

export function DashboardCanvas({
  dashboardConfig,
  dataContext,
  renderVersion,
  rows,
  sourceLabel,
  onChangeChartType,
  onDeleteComponent,
  onUpdateComponent,
}: DashboardCanvasProps) {
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);
  const [activeView, setActiveView] = useState<'report' | 'model'>('report');

  useEffect(() => {
    setActiveView('report');
    setFilters(defaultFilters);
  }, [renderVersion]);

  const activeRows = rows;
  const hasConnectedData = activeRows.length > 0;
  const brandOptions = useMemo(() => topDimensionValues(activeRows, 'brand', 100), [activeRows]);
  const channelOptions = useMemo(() => topDimensionValues(activeRows, 'channel', 100), [activeRows]);
  const filteredRows = useMemo(() => filterMarketingData(activeRows, filters), [activeRows, filters]);
  const summary = useMemo(() => summarizeMarketingData(filteredRows), [filteredRows]);
  const monthlyData = useMemo(() => groupByMonth(filteredRows), [filteredRows]);
  const channelData = useMemo(() => groupByChannel(filteredRows), [filteredRows]);
  const brandData = useMemo(() => groupByBrand(filteredRows), [filteredRows]);
  const displayTitle = compactDashboardTitle(dashboardConfig.title);
  const displayDescription = compactDashboardDescription(dashboardConfig.description);

  return (
    <section className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-slate-50">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Database className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-950">DashForge</p>
              <p className="truncate text-xs text-muted-foreground">{hasConnectedData ? 'Live data dashboard' : 'Connect data to begin'}</p>
            </div>
          </div>
          <div className="flex w-full items-center justify-between gap-3 xl:w-auto">
            <div className="flex max-w-full overflow-x-auto rounded-full border border-slate-200 bg-slate-50 p-1">
              {['Overview', 'Analytics', 'Finance', 'Reports'].map((item, index) => (
                <button
                  className={
                    index === 0
                      ? 'rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm'
                      : 'rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground'
                  }
                  key={item}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button className="h-9 w-9 rounded-full" size="icon" variant="outline" aria-label="Search">
                <Search className="h-4 w-4" />
              </Button>
              <Button className="h-9 w-9 rounded-full" size="icon" variant="outline" aria-label="Settings">
                <Settings className="h-4 w-4" />
              </Button>
              <Button className="h-9 w-9 rounded-full" size="icon" variant="secondary" aria-label="Profile">
                <UserRound className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-white px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => setActiveView('report')}
                size="sm"
                variant={activeView === 'report' ? 'secondary' : 'outline'}
              >
                Report view
              </Button>
              <Button
                onClick={() => setActiveView('model')}
                size="sm"
                variant={activeView === 'model' ? 'secondary' : 'outline'}
              >
                Data model
              </Button>
            <Badge>{hasConnectedData ? `${filteredRows.length.toLocaleString('en-GB')} rows` : 'No data'}</Badge>
            </div>
            <h1 className="mt-3 max-w-4xl break-words text-2xl font-semibold tracking-normal text-slate-950">{displayTitle}</h1>
            {displayDescription && (
              <p className="mt-1 max-w-3xl overflow-hidden text-ellipsis text-sm leading-6 text-slate-500">
                {displayDescription}
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap gap-2 xl:justify-end">
            <Badge className="max-w-[220px] truncate">
              <Database className="mr-1 h-3.5 w-3.5" />
              <span className="truncate">{sourceLabel}</span>
            </Badge>
            <Badge>
              <CalendarDays className="mr-1 h-3.5 w-3.5" />
              2026
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 xl:p-6">
        {activeView === 'report' ? (
          <>
            {hasConnectedData && <Filters brands={brandOptions} channels={channelOptions} filters={filters} onChange={setFilters} />}
            {hasConnectedData && (
              <DataInsights
                dataContext={dataContext}
                dimensionCount={brandOptions.length + channelOptions.length}
                recordCount={filteredRows.length}
                summary={summary}
              />
            )}
            {hasConnectedData && <InsightArchitectPanel dataContext={dataContext} />}
            {hasConnectedData && dashboardConfig.components.length ? (
              <DashboardRenderer
                config={dashboardConfig}
                data={{
                  summary,
                  monthly: monthlyData,
                  channel: channelData,
                  brand: brandData,
                }}
                onChangeChartType={onChangeChartType}
                onDeleteComponent={onDeleteComponent}
                onUpdateComponent={onUpdateComponent}
              />
            ) : (
              <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-sm text-muted-foreground">
                {hasConnectedData ? 'Use the AI Copilot to generate dashboard components.' : 'Connect CSV, Excel, database or API data to start.'}
              </div>
            )}
          </>
        ) : (
          <DataModelView dataContext={dataContext} rows={activeRows} sourceLabel={sourceLabel} />
        )}
      </div>
    </section>
  );
}
