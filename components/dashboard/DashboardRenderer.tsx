'use client';

import { Activity, AlertTriangle, CheckCircle2, Edit3, Gauge, Layers3, Percent, Repeat2, Trash2 } from 'lucide-react';
import { AreaChartCard } from '@/components/dashboard/AreaChartCard';
import { BarChartCard } from '@/components/dashboard/BarChartCard';
import { DataTable } from '@/components/dashboard/DataTable';
import { FunnelChartCard } from '@/components/dashboard/FunnelChartCard';
import { GaugeCard } from '@/components/dashboard/GaugeCard';
import { HeatmapCard } from '@/components/dashboard/HeatmapCard';
import { HorizontalBarChartCard } from '@/components/dashboard/HorizontalBarChartCard';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { LineChartCard } from '@/components/dashboard/LineChartCard';
import { PieChartCard } from '@/components/dashboard/PieChartCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCompactNumber, formatDashboardValue, type KpiSummary } from '@/lib/data/dataProcessor';
import type {
  BarChartComponentConfig,
  DashboardComponentConfig,
  DashboardConfig,
  DashboardDataSource,
  DashboardMetric,
  DataTableComponentConfig,
  AreaChartComponentConfig,
  FunnelComponentConfig,
  GaugeComponentConfig,
  HeatmapComponentConfig,
  HorizontalBarChartComponentConfig,
  KpiComponentConfig,
  LineChartComponentConfig,
  PieChartComponentConfig,
} from '@/types/dashboard';

type DashboardRendererProps = {
  config: DashboardConfig;
  data: Record<DashboardDataSource, Array<Record<string, string | number>> | KpiSummary>;
  onChangeChartType: (componentId: string) => void;
  onDeleteComponent: (componentId: string) => void;
  onUpdateComponent: (componentId: string, updater: (component: DashboardComponentConfig) => DashboardComponentConfig) => void;
};

const metricIcons = {
  leads: Layers3,
  valuations: Gauge,
  sessions: Activity,
  bookings: CheckCircle2,
  conversionRate: Percent,
};

function getMetricValue(summary: KpiSummary, metric: DashboardMetric) {
  if (metric === 'conversionRate') {
    return `${summary.conversionRate}%`;
  }

  return formatCompactNumber(summary[metric]);
}

function getDataset(
  data: DashboardRendererProps['data'],
  dataSource: Exclude<DashboardDataSource, 'summary'>,
) {
  const dataset = data[dataSource];
  return Array.isArray(dataset) ? dataset : [];
}

function formatTableRows(rows: Array<Record<string, string | number>>, columns: DataTableComponentConfig['columns']) {
  return rows.map((row) =>
    columns.reduce<Record<string, string | number>>((formattedRow, column) => {
      const value = row[column.key];
      formattedRow[column.key] = formatDashboardValue(value);
      return formattedRow;
    }, {}),
  );
}

function defaultVisualLayout(type: string) {
  if (['data_table', 'area_chart', 'heatmap'].includes(type)) {
    return 'xl:col-span-2';
  }

  return '';
}

function renderKpi(component: KpiComponentConfig, summary: KpiSummary) {
  const Icon = metricIcons[component.metric];

  return (
    <KpiCard
      change={component.change || 'Updated from dashboard JSON'}
      icon={Icon}
      title={component.title}
      trend={component.trend}
      value={getMetricValue(summary, component.metric)}
    />
  );
}

function renderLineChart(component: LineChartComponentConfig, data: DashboardRendererProps['data']) {
  return (
    <LineChartCard
      data={getDataset(data, component.dataSource)}
      lines={component.series.map((series) => ({
        key: series.metric,
        name: series.label,
        color: series.color,
      }))}
      title={component.title}
      xKey={component.xAxis}
    />
  );
}

function renderAreaChart(component: AreaChartComponentConfig, data: DashboardRendererProps['data']) {
  return (
    <AreaChartCard
      areas={component.series.map((series) => ({
        key: series.metric,
        name: series.label,
        color: series.color,
      }))}
      data={getDataset(data, component.dataSource)}
      title={component.title}
      xKey={component.xAxis}
    />
  );
}

function renderBarChart(component: BarChartComponentConfig, data: DashboardRendererProps['data']) {
  return (
    <BarChartCard
      color={component.color || '#1f7a8c'}
      data={getDataset(data, component.dataSource)}
      title={component.title}
      xKey={component.xAxis}
      yKey={component.yAxis}
    />
  );
}

function renderHorizontalBarChart(component: HorizontalBarChartComponentConfig, data: DashboardRendererProps['data']) {
  return (
    <HorizontalBarChartCard
      color={component.color || '#1f7a8c'}
      data={getDataset(data, component.dataSource)}
      title={component.title}
      xKey={component.xAxis}
      yKey={component.yAxis}
    />
  );
}

function renderPieChart(component: PieChartComponentConfig, data: DashboardRendererProps['data']) {
  return (
    <PieChartCard
      data={getDataset(data, component.dataSource)}
      nameKey={component.nameKey}
      title={component.title}
      valueKey={component.valueKey}
    />
  );
}

function renderDataTable(component: DataTableComponentConfig, data: DashboardRendererProps['data']) {
  const rows = getDataset(data, component.dataSource).slice(0, 100);

  return (
    <DataTable
      columns={component.columns}
      rows={formatTableRows(rows, component.columns)}
      title={component.title}
    />
  );
}

function renderGauge(component: GaugeComponentConfig, summary: KpiSummary) {
  return <GaugeCard metric={component.metric} summary={summary} target={component.target} title={component.title} />;
}

function renderFunnel(component: FunnelComponentConfig, summary: KpiSummary) {
  return <FunnelChartCard stages={component.stages} summary={summary} title={component.title} />;
}

function renderHeatmap(component: HeatmapComponentConfig, data: DashboardRendererProps['data']) {
  return <HeatmapCard data={getDataset(data, component.dataSource)} metrics={component.metrics} title={component.title} />;
}

function UnsupportedComponent({ title }: { title: string }) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        Unsupported dashboard component: {title}
      </CardContent>
    </Card>
  );
}

function ComponentToolbar({
  component,
  onChangeChartType,
  onDeleteComponent,
  onUpdateComponent,
}: {
  component: DashboardComponentConfig;
  onChangeChartType: (componentId: string) => void;
  onDeleteComponent: (componentId: string) => void;
  onUpdateComponent: (componentId: string, updater: (component: DashboardComponentConfig) => DashboardComponentConfig) => void;
}) {
  const canChangeChartType = ['line_chart', 'area_chart', 'bar_chart', 'horizontal_bar_chart', 'pie_chart'].includes(component.type);

  function renameComponent() {
    const nextTitle = window.prompt('Edit visual title', component.title);
    if (nextTitle?.trim()) {
      onUpdateComponent(component.id, (currentComponent) => ({ ...currentComponent, title: nextTitle.trim() }));
    }
  }

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-10 flex min-w-0 gap-1 rounded-md border border-slate-200 bg-white/90 p-1 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100">
      <Button aria-label="Edit title" className="h-7 w-7" onClick={renameComponent} size="icon" variant="ghost" title="Edit title">
        <Edit3 className="h-4 w-4" />
      </Button>
      {canChangeChartType && (
        <Button aria-label="Change chart type" className="h-7 w-7" onClick={() => onChangeChartType(component.id)} size="icon" variant="ghost" title="Change chart type">
          <Repeat2 className="h-4 w-4" />
        </Button>
      )}
      <Button aria-label="Delete component" className="h-7 w-7 text-slate-500 hover:text-red-600" onClick={() => onDeleteComponent(component.id)} size="icon" variant="ghost" title="Delete component">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function DashboardRenderer({
  config,
  data,
  onChangeChartType,
  onDeleteComponent,
  onUpdateComponent,
}: DashboardRendererProps) {
  const summary = data.summary as KpiSummary;
  const kpis = config.components.filter((component) => component.type === 'kpi');
  const visuals = config.components.filter((component) => component.type !== 'kpi');

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {kpis.map((component) => (
          <div className="group relative min-w-0" key={component.id}>
            <ComponentToolbar
              component={component}
              onChangeChartType={onChangeChartType}
              onDeleteComponent={onDeleteComponent}
              onUpdateComponent={onUpdateComponent}
            />
            {renderKpi(component, summary)}
          </div>
        ))}
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        {visuals.map((component) => (
          <div
            className={cn('group relative min-w-0', defaultVisualLayout(component.type), component.layout?.className)}
            key={component.id}
          >
            <ComponentToolbar
              component={component}
              onChangeChartType={onChangeChartType}
              onDeleteComponent={onDeleteComponent}
              onUpdateComponent={onUpdateComponent}
            />
            {component.type === 'line_chart' && renderLineChart(component, data)}
            {component.type === 'area_chart' && renderAreaChart(component, data)}
            {component.type === 'bar_chart' && renderBarChart(component, data)}
            {component.type === 'horizontal_bar_chart' && renderHorizontalBarChart(component, data)}
            {component.type === 'pie_chart' && renderPieChart(component, data)}
            {component.type === 'gauge' && renderGauge(component, summary)}
            {component.type === 'funnel' && renderFunnel(component, summary)}
            {component.type === 'heatmap' && renderHeatmap(component, data)}
            {component.type === 'data_table' && renderDataTable(component, data)}
            {![
              'line_chart',
              'area_chart',
              'bar_chart',
              'horizontal_bar_chart',
              'pie_chart',
              'gauge',
              'funnel',
              'heatmap',
              'data_table',
            ].includes(component.type) && (
              <UnsupportedComponent title={component.title} />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
