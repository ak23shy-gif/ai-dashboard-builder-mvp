import { validateDashboardConfig } from '@/lib/ai/dashboardSchema';
import type { DashboardDataContext } from '@/lib/data/importData';
import type {
  DashboardComponentConfig,
  DashboardConfig,
  DashboardMetric,
  TextBoxComponentConfig,
} from '@/types/dashboard';

type AdditiveMetric = Exclude<DashboardMetric, 'conversionRate'>;

const metricSlots: AdditiveMetric[] = ['leads', 'valuations', 'sessions', 'bookings'];
const colours = ['#1f7a8c', '#7c3aed', '#d88c36', '#4f7f52'];

function cleanLabel(value: string | undefined, fallback: string) {
  return String(value || fallback)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalise(value: string | undefined) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldLabel(dataContext: DashboardDataContext, sourceColumn: string | undefined, fallback: string) {
  return dataContext.fields.find((field) => field.name === sourceColumn)?.label || cleanLabel(sourceColumn, fallback);
}

function metricLabel(dataContext: DashboardDataContext, metric: AdditiveMetric) {
  return fieldLabel(dataContext, dataContext.metricSlots[metric], cleanLabel(metric, 'Measure'));
}

function dimensionLabel(dataContext: DashboardDataContext, dimension: 'brand' | 'channel') {
  const sourceColumn = dimension === 'brand' ? dataContext.dimensionSlots.primary : dataContext.dimensionSlots.secondary;
  return fieldLabel(dataContext, sourceColumn, dimension === 'brand' ? 'Primary Category' : 'Secondary Category');
}

function availableMetrics(dataContext: DashboardDataContext) {
  return metricSlots.filter((metric) => Boolean(dataContext.metricSlots[metric]));
}

function hasDimension(dataContext: DashboardDataContext, dimension: 'brand' | 'channel') {
  return Boolean(dimension === 'brand' ? dataContext.dimensionSlots.primary : dataContext.dimensionSlots.secondary);
}

function textBox(dataContext: DashboardDataContext): TextBoxComponentConfig {
  const metricNames = availableMetrics(dataContext)
    .map((metric) => metricLabel(dataContext, metric))
    .slice(0, 4);
  const dimensions = [
    dataContext.dimensionSlots.primary ? dimensionLabel(dataContext, 'brand') : null,
    dataContext.dimensionSlots.secondary ? dimensionLabel(dataContext, 'channel') : null,
  ].filter(Boolean);

  return {
    id: 'insights_overview',
    type: 'text_box',
    title: 'Insights Overview',
    content: [
      `Source: ${dataContext.sourceName}.`,
      metricNames.length ? `Key measures available: ${metricNames.join(', ')}.` : 'No reliable additive measures were detected.',
      dimensions.length ? `Useful breakdowns: ${dimensions.join(' and ')}.` : 'No low-cardinality category breakdown was detected.',
      'DashForge will build visuals only from these detected fields and will avoid identifier columns as measures.',
    ].join('\n'),
    layout: { className: 'xl:col-span-2' },
  };
}

function titleForPrompt(prompt: string, dataContext: DashboardDataContext) {
  const promptText = normalise(prompt);
  const sourceBase = dataContext.sourceName.replace(/\.[^.]+$/, '');

  if (promptText.includes('insight')) {
    return `${cleanLabel(sourceBase, 'Dataset')} Insights`;
  }

  if (/\b(exec|executive|overview|summary)\b/.test(promptText)) {
    return `${cleanLabel(sourceBase, 'Dataset')} Overview`;
  }

  return `${cleanLabel(sourceBase, 'Dataset')} Dashboard`;
}

function wantsOnlyText(prompt: string) {
  const text = normalise(prompt);
  return (
    (text.includes('text box') || text.includes('insight')) &&
    !/\b(chart|visual|kpi|table|dashboard|show|showing|trend|breakdown|by)\b/.test(text)
  );
}

function wantsTable(prompt: string) {
  return /\b(table|detail|record|rows|model)\b/.test(normalise(prompt));
}

function wantsShare(prompt: string) {
  return /\b(share|composition|split|mix|percentage)\b/.test(normalise(prompt));
}

function componentIds(components: DashboardComponentConfig[]) {
  const seen = new Set<string>();

  return components.filter((component) => {
    if (seen.has(component.id)) {
      return false;
    }
    seen.add(component.id);
    return true;
  });
}

export function createDashboardFromDataContext(
  prompt: string,
  currentDashboard: DashboardConfig | undefined,
  dataContext: DashboardDataContext,
) {
  const metrics = availableMetrics(dataContext);
  const primaryMetric = metrics[0];
  const secondaryMetric = metrics[1];
  const thirdMetric = metrics[2];
  const hasDate = Boolean(dataContext.dimensionSlots.date);
  const hasPrimaryDimension = hasDimension(dataContext, 'brand');
  const hasSecondaryDimension = hasDimension(dataContext, 'channel');
  const components: DashboardComponentConfig[] = [];

  if (wantsOnlyText(prompt)) {
    return validateDashboardConfig({
      id: currentDashboard?.id || `ai-dashboard-${Date.now()}`,
      title: titleForPrompt(prompt, dataContext),
      description: `Generated from ${dataContext.sourceName}. The dashboard uses only detected dataset fields and does not invent metrics.`,
      filters: [],
      components: [textBox(dataContext)],
    });
  }

  components.push(textBox(dataContext));

  metrics.slice(0, 4).forEach((metric) => {
    components.push({
      id: `kpi_${metric}`,
      type: 'kpi',
      title: metricLabel(dataContext, metric),
      metric,
      change: 'Dataset total',
      trend: 'up',
    });
  });

  if (primaryMetric && secondaryMetric) {
    components.push({
      id: 'kpi_calculated_rate',
      type: 'kpi',
      title: `${metricLabel(dataContext, secondaryMetric)} Rate`,
      metric: 'conversionRate',
      change: 'Calculated after filters',
      trend: 'up',
    });
  }

  if (hasDate && metrics.length) {
    components.push({
      id: 'period_trend',
      type: metrics.length > 1 ? 'area_chart' : 'line_chart',
      title: `${metrics.slice(0, 3).map((metric) => metricLabel(dataContext, metric)).join(', ')} by Period`,
      dataSource: 'monthly',
      xAxis: 'month',
      layout: { className: 'xl:col-span-2' },
      series: metrics.slice(0, 3).map((metric, index) => ({
        metric,
        label: metricLabel(dataContext, metric),
        color: colours[index],
      })),
    });
  }

  if (primaryMetric && hasSecondaryDimension) {
    components.push({
      id: `${primaryMetric}_by_secondary_dimension`,
      type: 'horizontal_bar_chart',
      title: `${metricLabel(dataContext, primaryMetric)} by ${dimensionLabel(dataContext, 'channel')}`,
      dataSource: 'channel',
      xAxis: primaryMetric,
      yAxis: 'channel',
      color: colours[1],
    });
  }

  if ((secondaryMetric || primaryMetric) && hasPrimaryDimension) {
    const metric = secondaryMetric || primaryMetric;
    components.push({
      id: `${metric}_by_primary_dimension`,
      type: 'bar_chart',
      title: `${metricLabel(dataContext, metric)} by ${dimensionLabel(dataContext, 'brand')}`,
      dataSource: 'brand',
      xAxis: 'brand',
      yAxis: metric,
      color: colours[0],
    });
  }

  if (wantsShare(prompt) && primaryMetric && hasSecondaryDimension) {
    components.push({
      id: `${primaryMetric}_share_by_secondary_dimension`,
      type: 'pie_chart',
      title: `${metricLabel(dataContext, primaryMetric)} Share by ${dimensionLabel(dataContext, 'channel')}`,
      dataSource: 'channel',
      nameKey: 'channel',
      valueKey: primaryMetric,
    });
  }

  if (hasDate && metrics.length >= 2) {
    components.push({
      id: 'period_intensity',
      type: 'heatmap',
      title: 'Measure Intensity by Period',
      dataSource: 'monthly',
      metrics: metrics.slice(0, 4),
    });
  }

  if (wantsTable(prompt) || hasPrimaryDimension || hasSecondaryDimension) {
    const dimension = hasSecondaryDimension ? 'channel' : 'brand';
    components.push({
      id: 'dimension_performance_table',
      type: 'data_table',
      title: `${dimensionLabel(dataContext, dimension)} Detail`,
      dataSource: dimension,
      layout: { className: 'xl:col-span-2' },
      columns: [
        { key: dimension, label: dimensionLabel(dataContext, dimension) },
        ...metrics.slice(0, 4).map((metric) => ({ key: metric, label: metricLabel(dataContext, metric) })),
      ],
    });
  }

  return validateDashboardConfig({
    id: currentDashboard?.id || `ai-dashboard-${Date.now()}`,
    title: titleForPrompt(prompt, dataContext),
    description: `Generated from ${dataContext.sourceName}. Fields were selected from the detected dataset structure: ${dataContext.fields
      .map((field) => field.label)
      .slice(0, 8)
      .join(', ')}.`,
    filters: [
      ...(hasPrimaryDimension
        ? [{ id: 'brand_filter', type: 'select_filter' as const, field: 'brand' as const, title: dimensionLabel(dataContext, 'brand') }]
        : []),
      ...(hasSecondaryDimension
        ? [{ id: 'channel_filter', type: 'select_filter' as const, field: 'channel' as const, title: dimensionLabel(dataContext, 'channel') }]
        : []),
      ...(hasDate ? [{ id: 'date_filter', type: 'date_filter' as const, field: 'month' as const, title: 'Period' }] : []),
    ],
    components: componentIds(components),
  });
}
