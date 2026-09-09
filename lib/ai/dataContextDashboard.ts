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

function inferDomain(dataContext: DashboardDataContext) {
  const text = normalise(`${dataContext.sourceName} ${dataContext.fields.map((field) => field.name).join(' ')}`);

  if (/\b(order|sales|revenue|profit|customer|retail|invoice|product)\b/.test(text)) {
    return 'Commercial / transaction performance data';
  }

  if (/\b(employee|hr|salary|department|absence|attrition|headcount)\b/.test(text)) {
    return 'HR / workforce data';
  }

  if (/\b(patient|clinic|health|appointment|diagnosis|treatment)\b/.test(text)) {
    return 'Healthcare / service activity data';
  }

  if (/\b(shipment|delivery|warehouse|route|carrier|stock|inventory)\b/.test(text)) {
    return 'Logistics / operations data';
  }

  if (/\b(session|campaign|lead|channel|traffic|conversion|website)\b/.test(text)) {
    return 'Marketing / digital performance data';
  }

  if (/\b(ticket|case|incident|sla|priority|status|resolved)\b/.test(text)) {
    return 'Service / support operations data';
  }

  return 'General business dataset';
}

function fieldTypeLabel(role: string) {
  const labels: Record<string, string> = {
    date: 'date',
    dimension: 'category',
    measure: 'number',
    currency: 'number/currency',
    percentage: 'percentage',
    identifier: 'text/id',
    unknown: 'text/unknown',
  };

  return labels[role] || role;
}

function fieldList(dataContext: DashboardDataContext) {
  return dataContext.fields
    .map((field) => {
      const samples = field.sampleValues.length ? `; examples: ${field.sampleValues.join(', ')}` : '';
      const mapping = field.mappedTo ? `; mapped as ${field.mappedTo}` : '';
      return `- ${field.label} (${field.name}): ${fieldTypeLabel(field.role)}; ${field.distinctValues} distinct${mapping}${samples}`;
    })
    .join('\n');
}

function kpiDefinitions(dataContext: DashboardDataContext) {
  const metrics = availableMetrics(dataContext).slice(0, 4);
  const definitions = metrics.map((metric) => {
    const sourceColumn = dataContext.metricSlots[metric];
    return `- ${metricLabel(dataContext, metric)} = SUM([${sourceColumn}])`;
  });

  if (metrics.length >= 2) {
    definitions.push(
      `- ${metricLabel(dataContext, metrics[1])} Rate = SUM([${dataContext.metricSlots[metrics[1]]}]) / SUM([${
        dataContext.metricSlots[metrics[0]]
      }])`,
    );
  }

  return definitions.length ? definitions.join('\n') : '- No reliable additive KPI was detected from the uploaded fields.';
}

function comparisonPlan(dataContext: DashboardDataContext) {
  const metrics = availableMetrics(dataContext);
  const comparisons: string[] = [];

  if (dataContext.dimensionSlots.date && metrics[0]) {
    comparisons.push(`- Trend over time: ${metricLabel(dataContext, metrics[0])} by ${fieldLabel(dataContext, dataContext.dimensionSlots.date, 'Period')}.`);
  }

  if (dataContext.dimensionSlots.secondary && metrics[0]) {
    comparisons.push(`- Category comparison: ${metricLabel(dataContext, metrics[0])} by ${dimensionLabel(dataContext, 'channel')}, sorted highest to lowest.`);
  }

  if (dataContext.dimensionSlots.primary && (metrics[1] || metrics[0])) {
    comparisons.push(
      `- Driver comparison: ${metricLabel(dataContext, metrics[1] || metrics[0])} by ${dimensionLabel(dataContext, 'brand')}, not alphabetical.`,
    );
  }

  if (metrics.length >= 2) {
    comparisons.push(`- Efficiency comparison: ratio of ${metricLabel(dataContext, metrics[1])} to ${metricLabel(dataContext, metrics[0])}.`);
  }

  return comparisons.length ? comparisons.join('\n') : '- No meaningful comparison dimension was detected.';
}

function visualRationale(dataContext: DashboardDataContext) {
  const metrics = availableMetrics(dataContext);
  const rationale: string[] = [];

  if (dataContext.dimensionSlots.date && metrics.length) {
    rationale.push(
      `- Line/area chart for period trend, because time movement is easier to read as a connected trend; a pie chart would hide seasonality and change.`,
    );
  }

  if (dataContext.dimensionSlots.secondary && metrics[0]) {
    rationale.push(
      `- Horizontal bar chart for ${dimensionLabel(dataContext, 'channel')} ranking, because long labels and sorted values are readable; a pie chart would mislead if there are many categories.`,
    );
  }

  if (dataContext.dimensionSlots.primary && (metrics[1] || metrics[0])) {
    rationale.push(
      `- Bar chart for ${dimensionLabel(dataContext, 'brand')} comparison, because category vs category is the question; a KPI alone would hide which category drives the result.`,
    );
  }

  rationale.push('- Table for detail/drill-down, because high-cardinality records are better scanned as rows than forced into crowded charts.');

  return rationale.join('\n');
}

function filterPlan(dataContext: DashboardDataContext) {
  const filters = [
    dataContext.dimensionSlots.primary ? `- ${dimensionLabel(dataContext, 'brand')}` : null,
    dataContext.dimensionSlots.secondary ? `- ${dimensionLabel(dataContext, 'channel')}` : null,
    dataContext.dimensionSlots.date ? `- ${fieldLabel(dataContext, dataContext.dimensionSlots.date, 'Period')}` : null,
  ].filter(Boolean);

  return filters.length ? filters.join('\n') : '- No reliable slicer fields detected.';
}

function outlierPlan(dataContext: DashboardDataContext) {
  const metrics = availableMetrics(dataContext);

  if (!metrics.length) {
    return 'No numeric measure was detected, so anomaly callouts are not shown.';
  }

  return `Watch for unusually high/low ${metricLabel(dataContext, metrics[0])} by period or category. The dashboard surfaces this through sorted ranking charts and period intensity; full statistical anomaly detection should compare each value to its recent average/IQR.`;
}

function layoutPlan(dataContext: DashboardDataContext) {
  const metrics = availableMetrics(dataContext);
  const steps = ['1. Insights Overview: source, grain, field mapping, KPI formulas and chart reasoning.'];

  if (metrics.length) {
    steps.push(`2. KPI strip: ${metrics.slice(0, 4).map((metric) => metricLabel(dataContext, metric)).join(', ')}.`);
  }

  if (dataContext.dimensionSlots.date) {
    steps.push('3. Trend section: period movement before category drill-down.');
  }

  if (dataContext.dimensionSlots.primary || dataContext.dimensionSlots.secondary) {
    steps.push('4. Driver section: ranked category comparisons sorted by value.');
  }

  steps.push('5. Detail section: table for lookup, QA and follow-up.');

  return steps.join('\n');
}

function textBox(dataContext: DashboardDataContext, prompt: string): TextBoxComponentConfig {
  const businessQuestion =
    prompt.trim() || 'Assumption: identify what is performing best or worst, what changed over time, and which category needs action.';
  const audience = 'Assumption: business users and analysts who need a quick read plus enough detail to investigate.';

  return {
    id: 'insights_overview',
    type: 'text_box',
    title: 'Insights Overview',
    content: [
      `Domain/source: ${inferDomain(dataContext)} from ${dataContext.sourceName} (${dataContext.sourceType.toUpperCase()}).`,
      '',
      `Columns/fields:\n${fieldList(dataContext)}`,
      '',
      `Grain: ${dataContext.grain || 'one source row or event record'}.`,
      `Time range & frequency: ${dataContext.timeRange?.label || 'not detected'}; ${dataContext.timeRange?.frequency || 'not detected'}.`,
      `Business question: ${businessQuestion}`,
      `Audience: ${audience}`,
      '',
      `KPIs that matter most:\n${kpiDefinitions(dataContext)}`,
      '',
      `Meaningful comparisons:\n${comparisonPlan(dataContext)}`,
      '',
      `Chart choices and why:\n${visualRationale(dataContext)}`,
      '',
      `Filters/slicers:\n${filterPlan(dataContext)}`,
      '',
      `Outlier / so-what callout: ${outlierPlan(dataContext)}`,
      '',
      `Suggested layout / reading order:\n${layoutPlan(dataContext)}`,
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
      components: [textBox(dataContext, prompt)],
    });
  }

  components.push(textBox(dataContext, prompt));

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
