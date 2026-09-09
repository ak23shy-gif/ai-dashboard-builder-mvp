'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Database } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataInsights } from '@/components/dashboard/DataInsights';
import { DataModelView } from '@/components/dashboard/DataModelView';
import { DashboardRenderer } from '@/components/dashboard/DashboardRenderer';
import { Filters } from '@/components/dashboard/Filters';
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

  return (
    <section className="min-w-0 flex-1 overflow-auto bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
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
            <h1 className="mt-3 text-2xl font-semibold tracking-normal text-slate-950">{dashboardConfig.title}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              {dashboardConfig.description}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>
              <Database className="mr-1 h-3.5 w-3.5" />
              {sourceLabel}
            </Badge>
            <Badge>
              <CalendarDays className="mr-1 h-3.5 w-3.5" />
              2026
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-6">
        {activeView === 'report' ? (
          <>
            {hasConnectedData && <Filters brands={brandOptions} channels={channelOptions} filters={filters} onChange={setFilters} />}
            {hasConnectedData && (
              <DataInsights
                dimensionCount={brandOptions.length + channelOptions.length}
                recordCount={filteredRows.length}
                summary={summary}
              />
            )}
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
