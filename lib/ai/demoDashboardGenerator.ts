import { defaultDashboardConfig, validateDashboardConfig } from '@/lib/ai/dashboardSchema';
import type {
  BarChartComponentConfig,
  DashboardComponentConfig,
  DashboardConfig,
  DashboardMetric,
  DataTableComponentConfig,
  KpiComponentConfig,
  PieChartComponentConfig,
} from '@/types/dashboard';

const channelFilter = { id: 'channel_filter', type: 'select_filter' as const, field: 'channel' as const, title: 'Channel' };
const brandFilter = { id: 'brand_filter', type: 'select_filter' as const, field: 'brand' as const, title: 'Brand' };
const dateFilter = { id: 'date_filter', type: 'date_filter' as const, field: 'month' as const, title: 'Month range' };

function ensureDefaultFilters(dashboard: DashboardConfig) {
  const filters = dashboard.filters || [];

  return [
    filters.some((filter) => filter.id === brandFilter.id) ? null : brandFilter,
    filters.some((filter) => filter.id === channelFilter.id) ? null : channelFilter,
    filters.some((filter) => filter.id === dateFilter.id) ? null : dateFilter,
    ...filters,
  ].filter(Boolean) as DashboardConfig['filters'];
}

function dedupeComponents(components: DashboardComponentConfig[]) {
  const seen = new Set<string>();

  return components.filter((component) => {
    if (seen.has(component.id)) {
      return false;
    }

    seen.add(component.id);
    return true;
  });
}

function metricLabel(metric: DashboardMetric) {
  const labels: Record<DashboardMetric, string> = {
    leads: 'Primary volume',
    valuations: 'Qualified records',
    sessions: 'Activity volume',
    bookings: 'Completed outcomes',
    conversionRate: 'Completion rate',
  };

  return labels[metric];
}

function metricFromPrompt(prompt: string): Exclude<DashboardMetric, 'conversionRate'> {
  if (/booking/i.test(prompt)) {
    return 'bookings';
  }

  if (/session|website/i.test(prompt)) {
    return 'sessions';
  }

  if (/valuation/i.test(prompt)) {
    return 'valuations';
  }

  return 'leads';
}

function makeKpi(metric: DashboardMetric): KpiComponentConfig {
  const changes: Record<DashboardMetric, string> = {
    leads: '+14.8% vs plan',
    valuations: '+9.6% vs plan',
    sessions: '+21.2% YoY',
    bookings: '+7.4% vs plan',
    conversionRate: '-0.8 pts',
  };

  return {
    id: `kpi_${metric}`,
    type: 'kpi',
    title: metricLabel(metric),
    metric,
    change: changes[metric],
    trend: metric === 'conversionRate' ? 'down' : 'up',
  };
}

function makeBarChart(metric: Exclude<DashboardMetric, 'conversionRate'>, dimension: 'channel' | 'brand'): BarChartComponentConfig {
  return {
    id: `${metric}_by_${dimension}`,
    type: 'bar_chart',
    title: `${metricLabel(metric)} by ${dimension === 'brand' ? 'Brand' : 'Channel'}`,
    dataSource: dimension,
    xAxis: dimension,
    yAxis: metric,
    color: dimension === 'brand' ? '#1f7a8c' : '#7c3aed',
  };
}

function makePieChart(metric: Exclude<DashboardMetric, 'conversionRate'>, dimension: 'channel' | 'brand'): PieChartComponentConfig {
  return {
    id: `${metric}_share_by_${dimension}`,
    type: 'pie_chart',
    title: `${metricLabel(metric)} Share by ${dimension === 'brand' ? 'Brand' : 'Channel'}`,
    dataSource: dimension,
    nameKey: dimension,
    valueKey: metric,
  };
}

function makeTable(dimension: 'channel' | 'brand'): DataTableComponentConfig {
  return {
    id: `${dimension}_performance_table`,
    type: 'data_table',
    title: `${dimension === 'brand' ? 'Brand' : 'Channel'} Performance Table`,
    dataSource: dimension,
    columns: [
      { key: dimension, label: dimension === 'brand' ? 'Brand' : 'Channel' },
      { key: 'leads', label: 'Leads' },
      { key: 'valuations', label: 'Valuations' },
      { key: 'sessions', label: 'Sessions' },
      { key: 'bookings', label: 'Bookings' },
    ],
  };
}

function createBaseDashboard(prompt: string): DashboardConfig {
  const includeBookings = /booking|conversion/i.test(prompt);
  const includeBrand = /brand|company|category|product|department|team|client/i.test(prompt);
  const includeChannel = /channel|region|status|segment|source|location|market/i.test(prompt) || !includeBrand;

  return validateDashboardConfig({
    ...defaultDashboardConfig,
    id: 'ai-performance-dashboard',
    title: /session|activity|volume/i.test(prompt) ? 'Activity Overview' : 'Performance Overview',
    description: 'Generated from your prompt using structured Dashboard JSON and the active dataset.',
    filters: [brandFilter, channelFilter, dateFilter],
    components: [
      {
        id: 'kpi_total_leads',
        type: 'kpi',
        title: 'Primary volume',
        metric: 'leads',
        change: '+14.8% vs plan',
        trend: 'up',
      },
      {
        id: 'kpi_valuations',
        type: 'kpi',
        title: 'Qualified records',
        metric: 'valuations',
        change: '+9.6% vs plan',
        trend: 'up',
      },
      {
        id: 'kpi_sessions',
        type: 'kpi',
        title: 'Activity volume',
        metric: 'sessions',
        change: '+21.2% YoY',
        trend: 'up',
      },
      ...(includeBookings
        ? [
            {
              id: 'kpi_booking_rate',
              type: 'kpi' as const,
              title: 'Completion rate',
              metric: 'conversionRate' as const,
              change: '-0.8 pts',
              trend: 'down' as const,
            },
          ]
        : []),
      {
        id: 'monthly_performance',
        type: 'line_chart',
        title: includeBookings ? 'Performance Trend by Month' : 'Activity Trend by Month',
        dataSource: 'monthly',
        xAxis: 'month',
        series: includeBookings
          ? [
              { metric: 'leads', label: 'Primary volume', color: '#1f7a8c' },
              { metric: 'valuations', label: 'Qualified records', color: '#d88c36' },
              { metric: 'bookings', label: 'Completed outcomes', color: '#4f7f52' },
            ]
          : [
              { metric: 'leads', label: 'Primary volume', color: '#1f7a8c' },
              { metric: 'valuations', label: 'Qualified records', color: '#d88c36' },
              { metric: 'sessions', label: 'Activity volume', color: '#7c3aed' },
            ],
      },
      ...(includeChannel
        ? [
            {
              id: 'channel_share',
              type: 'pie_chart' as const,
              title: 'Composition by Channel',
              dataSource: 'channel' as const,
              nameKey: 'channel' as const,
              valueKey: 'leads' as const,
            },
            {
              id: 'leads_by_channel',
              type: 'bar_chart' as const,
              title: 'Primary Volume by Channel',
              dataSource: 'channel' as const,
              xAxis: 'channel' as const,
              yAxis: 'leads' as const,
              color: '#7c3aed',
            },
          ]
        : []),
      ...(includeBrand
        ? [
            {
              id: 'valuations_by_brand',
              type: 'bar_chart' as const,
              title: 'Qualified Records by Brand',
              dataSource: 'brand' as const,
              xAxis: 'brand' as const,
              yAxis: 'valuations' as const,
              color: '#1f7a8c',
            },
          ]
        : []),
      {
        id: includeBrand ? 'brand_performance_table' : 'channel_performance_table',
        type: 'data_table',
        title: includeBrand ? 'Brand Performance Table' : 'Channel Performance Table',
        dataSource: includeBrand ? 'brand' : 'channel',
        columns: [
          { key: includeBrand ? 'brand' : 'channel', label: includeBrand ? 'Brand' : 'Channel' },
          { key: 'leads', label: 'Primary volume' },
          { key: 'valuations', label: 'Qualified records' },
          { key: 'sessions', label: 'Activity volume' },
          { key: 'bookings', label: 'Completed outcomes' },
        ],
      },
    ],
  });
}

function changeLeadsChartToBar(dashboard: DashboardConfig): DashboardConfig {
  const components = dashboard.components.map((component) => {
    if (component.id === 'monthly_performance' || (component.type === 'line_chart' && /lead/i.test(component.title))) {
      return {
        id: 'leads_by_channel',
        type: 'bar_chart' as const,
        title: 'Primary Volume by Channel',
        dataSource: 'channel' as const,
        xAxis: 'channel' as const,
        yAxis: 'leads' as const,
        color: '#7c3aed',
      };
    }

    return component;
  });

  return validateDashboardConfig({
    ...dashboard,
    title: dashboard.title,
    description: 'Updated by the local dashboard planner: primary trend changed to a bar chart.',
    filters: ensureDefaultFilters(dashboard),
    components: dedupeComponents(components),
  });
}

function addChannelFilter(dashboard: DashboardConfig): DashboardConfig {
  return validateDashboardConfig({
    ...dashboard,
    description: 'Updated by the local dashboard planner: category filtering is enabled.',
    filters: ensureDefaultFilters({
      ...dashboard,
      filters: [...(dashboard.filters || []), channelFilter],
    }),
  });
}

function addSessionsKpi(dashboard: DashboardConfig): DashboardConfig {
  const hasSessionsKpi = dashboard.components.some(
    (component) => component.type === 'kpi' && component.metric === 'sessions',
  );

  if (hasSessionsKpi) {
    return dashboard;
  }

  return validateDashboardConfig({
    ...dashboard,
    description: 'Updated by the local dashboard planner: activity volume KPI added.',
    components: [
      {
        id: 'kpi_sessions',
        type: 'kpi',
        title: 'Activity volume',
        metric: 'sessions',
        change: '+21.2% YoY',
        trend: 'up',
      },
      ...dashboard.components,
    ],
  });
}

function addMetricKpi(dashboard: DashboardConfig, metric: DashboardMetric): DashboardConfig {
  const hasMetric = dashboard.components.some((component) => component.type === 'kpi' && component.metric === metric);

  if (hasMetric) {
    return validateDashboardConfig({
      ...dashboard,
      description: `Updated by the local dashboard planner: ${metricLabel(metric).toLowerCase()} KPI is already present.`,
    });
  }

  return validateDashboardConfig({
    ...dashboard,
    description: `Updated by the local dashboard planner: ${metricLabel(metric).toLowerCase()} KPI added.`,
    components: dedupeComponents([makeKpi(metric), ...dashboard.components]),
  });
}

function addMetricChart(dashboard: DashboardConfig, prompt: string): DashboardConfig {
  const metric = metricFromPrompt(prompt);
  const dimension = /brand|company|nurtur|starberry|yomdel|tpj/i.test(prompt) ? 'brand' : 'channel';
  const chart = /pie|donut|share/i.test(prompt) ? makePieChart(metric, dimension) : makeBarChart(metric, dimension);

  return validateDashboardConfig({
    ...dashboard,
    description: `Updated by the local dashboard planner: ${chart.title.toLowerCase()} added.`,
    filters: ensureDefaultFilters(dashboard),
    components: dedupeComponents([...dashboard.components, chart]),
  });
}

function addPerformanceTable(dashboard: DashboardConfig, prompt: string): DashboardConfig {
  const dimension = /brand|company|nurtur|starberry|yomdel|tpj/i.test(prompt) ? 'brand' : 'channel';

  return validateDashboardConfig({
    ...dashboard,
    description: `Updated by the local dashboard planner: ${dimension} performance table added.`,
    filters: ensureDefaultFilters(dashboard),
    components: dedupeComponents([...dashboard.components, makeTable(dimension)]),
  });
}

function removeMatchingComponents(dashboard: DashboardConfig, prompt: string): DashboardConfig {
  const metric = metricFromPrompt(prompt);
  const removeKpi = /kpi|card|metric/i.test(prompt);
  const removeTable = /table/i.test(prompt);
  const removeChart = /chart|line|bar|pie|donut|visual/i.test(prompt) || !removeKpi;

  const components = dashboard.components.filter((component) => {
    const title = component.title.toLowerCase();
    const mentionsMetric = title.includes(metricLabel(metric).toLowerCase()) ||
      (component.type === 'kpi' && component.metric === metric) ||
      (component.type === 'bar_chart' && component.yAxis === metric) ||
      (component.type === 'pie_chart' && component.valueKey === metric) ||
      (component.type === 'line_chart' && component.series.some((series) => series.metric === metric));

    if (removeKpi && component.type === 'kpi' && mentionsMetric) {
      return false;
    }

    if (removeTable && component.type === 'data_table') {
      return false;
    }

    if (removeChart && ['line_chart', 'bar_chart', 'pie_chart'].includes(component.type) && mentionsMetric) {
      return false;
    }

    return true;
  });

  return validateDashboardConfig({
    ...dashboard,
    description: `Updated by the local dashboard planner: removed matching ${metricLabel(metric).toLowerCase()} component.`,
    components,
  });
}

function changePieDimension(dashboard: DashboardConfig, prompt: string): DashboardConfig {
  const dimension = /brand|company|nurtur|starberry|yomdel|tpj/i.test(prompt) ? 'brand' : 'channel';
  const metric = metricFromPrompt(prompt);
  const components = dashboard.components.map((component) => {
    if (component.type === 'pie_chart') {
      return makePieChart(metric, dimension);
    }

    return component;
  });

  return validateDashboardConfig({
    ...dashboard,
    description: `Updated by the local dashboard planner: pie chart now shows ${metricLabel(metric).toLowerCase()} by ${dimension}.`,
    filters: ensureDefaultFilters(dashboard),
    components: dedupeComponents(components),
  });
}

function focusOnSessions(prompt: string): DashboardConfig {
  return validateDashboardConfig({
    ...createBaseDashboard(prompt),
    id: 'website-sessions-dashboard',
    title: 'Activity Overview',
    description: 'Generated by the local dashboard planner with a focus on activity volume over time.',
    components: [
      makeKpi('sessions'),
      makeKpi('leads'),
      makeKpi('valuations'),
      {
        id: 'monthly_sessions',
        type: 'line_chart',
        title: 'Activity and Outcome Trend by Month',
        dataSource: 'monthly',
        xAxis: 'month',
        series: [
          { metric: 'sessions', label: 'Activity volume', color: '#7c3aed' },
          { metric: 'leads', label: 'Primary volume', color: '#1f7a8c' },
          { metric: 'valuations', label: 'Qualified records', color: '#d88c36' },
        ],
      },
      makePieChart('sessions', 'channel'),
      makeBarChart('sessions', 'brand'),
      makeTable('channel'),
    ],
  });
}

export function generateDemoDashboard(prompt: string, currentDashboard?: DashboardConfig): DashboardConfig {
  const normalizedPrompt = prompt.toLowerCase();
  const dashboard = validateDashboardConfig(currentDashboard || createBaseDashboard(prompt));

  if (normalizedPrompt.includes('reset')) {
    return validateDashboardConfig(defaultDashboardConfig);
  }

  if (normalizedPrompt.includes('focus') && (normalizedPrompt.includes('session') || normalizedPrompt.includes('website'))) {
    return focusOnSessions(prompt);
  }

  if (normalizedPrompt.includes('remove') || normalizedPrompt.includes('delete')) {
    return removeMatchingComponents(dashboard, prompt);
  }

  if (normalizedPrompt.includes('add') && normalizedPrompt.includes('channel') && normalizedPrompt.includes('filter')) {
    return addChannelFilter(dashboard);
  }

  if (normalizedPrompt.includes('add') && (normalizedPrompt.includes('kpi') || normalizedPrompt.includes('card'))) {
    return addMetricKpi(dashboard, normalizedPrompt.includes('conversion') ? 'conversionRate' : metricFromPrompt(prompt));
  }

  if (normalizedPrompt.includes('add') && normalizedPrompt.includes('table')) {
    return addPerformanceTable(dashboard, prompt);
  }

  if (normalizedPrompt.includes('add') && (normalizedPrompt.includes('chart') || normalizedPrompt.includes('visual'))) {
    return addMetricChart(dashboard, prompt);
  }

  if ((normalizedPrompt.includes('change') || normalizedPrompt.includes('switch')) && normalizedPrompt.includes('pie')) {
    return changePieDimension(dashboard, prompt);
  }

  if (
    normalizedPrompt.includes('lead') &&
    normalizedPrompt.includes('bar') &&
    (normalizedPrompt.includes('change') || normalizedPrompt.includes('convert'))
  ) {
    return changeLeadsChartToBar(dashboard);
  }

  if (normalizedPrompt.includes('session') && normalizedPrompt.includes('kpi')) {
    return addSessionsKpi(dashboard);
  }

  return dashboard;
}

export const generateLocalDashboard = generateDemoDashboard;
