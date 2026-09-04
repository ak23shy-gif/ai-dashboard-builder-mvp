import type { DashboardConfig } from '@/types/dashboard';

export const defaultDashboardConfig: DashboardConfig = {
  id: 'performance-overview',
  title: 'Performance Overview',
  description: 'AI-generated dashboard rendered from structured JSON and active dataset fields.',
  filters: [
    { id: 'brand_filter', type: 'select_filter', field: 'brand', title: 'Brand' },
    { id: 'channel_filter', type: 'select_filter', field: 'channel', title: 'Channel' },
    { id: 'date_filter', type: 'date_filter', field: 'month', title: 'Month range' },
  ],
  components: [
    {
      id: 'kpi_total_leads',
      type: 'kpi',
      title: 'Primary volume',
      metric: 'leads',
      change: '+14.8% vs plan',
    },
    {
      id: 'kpi_valuations',
      type: 'kpi',
      title: 'Qualified records',
      metric: 'valuations',
      change: '+9.6% vs plan',
    },
    {
      id: 'kpi_sessions',
      type: 'kpi',
      title: 'Activity volume',
      metric: 'sessions',
      change: '+21.2% YoY',
    },
    {
      id: 'kpi_bookings',
      type: 'kpi',
      title: 'Completed outcomes',
      metric: 'bookings',
      change: '+7.4% vs plan',
    },
    {
      id: 'kpi_conversion_rate',
      type: 'kpi',
      title: 'Completion rate',
      metric: 'conversionRate',
      change: '-0.8 pts',
      trend: 'down',
    },
    {
      id: 'monthly_performance',
      type: 'line_chart',
      title: 'Trend by Month',
      dataSource: 'monthly',
      xAxis: 'month',
      series: [
        { metric: 'leads', label: 'Primary volume', color: '#1f7a8c' },
        { metric: 'valuations', label: 'Qualified records', color: '#d88c36' },
        { metric: 'bookings', label: 'Completed outcomes', color: '#4f7f52' },
      ],
    },
    {
      id: 'channel_share',
      type: 'pie_chart',
      title: 'Composition by Channel',
      dataSource: 'channel',
      nameKey: 'channel',
      valueKey: 'leads',
    },
    {
      id: 'leads_by_channel',
      type: 'bar_chart',
      title: 'Primary Volume by Channel',
      dataSource: 'channel',
      xAxis: 'channel',
      yAxis: 'leads',
      color: '#7c3aed',
    },
    {
      id: 'valuations_by_brand',
      type: 'bar_chart',
      title: 'Qualified Records by Brand',
      dataSource: 'brand',
      xAxis: 'brand',
      yAxis: 'valuations',
      color: '#1f7a8c',
    },
    {
      id: 'brand_performance_table',
      type: 'data_table',
      title: 'Dimension Performance Table',
      dataSource: 'brand',
      layout: { className: '2xl:col-span-2' },
      columns: [
        { key: 'brand', label: 'Brand' },
        { key: 'leads', label: 'Primary volume' },
        { key: 'valuations', label: 'Qualified records' },
        { key: 'sessions', label: 'Activity volume' },
        { key: 'bookings', label: 'Completed outcomes' },
      ],
    },
  ],
};

const allowedComponentTypes = new Set([
  'kpi',
  'line_chart',
  'area_chart',
  'bar_chart',
  'horizontal_bar_chart',
  'pie_chart',
  'gauge',
  'funnel',
  'heatmap',
  'data_table',
]);

export function validateDashboardConfig(value: unknown): DashboardConfig {
  if (!value || typeof value !== 'object') {
    return defaultDashboardConfig;
  }

  const candidate = value as Partial<DashboardConfig>;
  const components = Array.isArray(candidate.components)
    ? candidate.components.filter((component) => allowedComponentTypes.has(String(component.type)))
    : defaultDashboardConfig.components;

  return {
    id: candidate.id || defaultDashboardConfig.id,
    title: candidate.title || defaultDashboardConfig.title,
    description: candidate.description || defaultDashboardConfig.description,
    filters: candidate.filters || defaultDashboardConfig.filters,
    components: components.length ? components : defaultDashboardConfig.components,
  };
}
