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
  const briefMetrics = dataContext.analystBrief?.kpis
    .map((kpi) => metricSlots.find((metric) => dataContext.metricSlots[metric] === kpi.sourceColumn))
    .filter((metric): metric is AdditiveMetric => Boolean(metric));
  const fallbackMetrics = metricSlots.filter((metric) => Boolean(dataContext.metricSlots[metric]));

  return Array.from(new Set([...(briefMetrics || []), ...fallbackMetrics]));
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
  const steps = ['1. Header banner: global slicers, source status, row count and refresh context.'];

  if (metrics.length) {
    steps.push(`2. Row 1 executive summary: ${metrics.slice(0, 4).map((metric) => metricLabel(dataContext, metric)).join(', ')} KPI cards.`);
  }

  if (dataContext.dimensionSlots.date) {
    steps.push('3. Row 2 primary drivers: period trend with prior-period comparison logic.');
  }

  if (dataContext.dimensionSlots.primary || dataContext.dimensionSlots.secondary) {
    steps.push('4. Row 2/3 primary drivers: ranked category comparisons sorted by value.');
  }

  steps.push('5. Row 3 deep-dive: detail table for lookup, QA and follow-up.');

  return steps.join('\n');
}

function textBox(dataContext: DashboardDataContext, prompt: string): TextBoxComponentConfig {
  const brief = dataContext.analystBrief;
  const businessQuestion =
    prompt.trim() || brief?.businessQuestion || 'Assumption: identify what is performing best or worst, what changed over time, and which category needs action.';
  const audience = brief?.audience || 'Assumption: business users and analysts who need a quick read plus enough detail to investigate.';

  return {
    id: 'analyst_plan',
    type: 'text_box',
    title: 'Analyst Plan',
    content: [
      'Phase 1: Business Objective & KPIs',
      `Objective: ${businessQuestion}`,
      `Domain/source: ${brief?.domain || inferDomain(dataContext)} from ${dataContext.sourceName} (${dataContext.sourceType.toUpperCase()}).`,
      `Audience: ${audience}`,
      `Top-line KPI cards:\n${brief?.kpis.length ? brief.kpis.map((kpi) => `- ${kpi.label} = ${kpi.formula}; ${kpi.reason}`).join('\n') : kpiDefinitions(dataContext)}`,
      '',
      'Phase 2: Data Model & Metric Logic',
      `Data dictionary & scoping:\n${fieldList(dataContext)}`,
      `Grain: ${brief?.grain || dataContext.grain || 'one source row or event record'}.`,
      `Time range & frequency: ${dataContext.timeRange?.label || 'not detected'}; ${dataContext.timeRange?.frequency || 'not detected'}.`,
      `Filter controls:\n${brief?.filters.length ? brief.filters.map((filter) => `- ${filter}`).join('\n') : filterPlan(dataContext)}`,
      '',
      'Phase 3: Visual Hierarchy & Page Layout',
      brief?.layout.length ? brief.layout.map((item, index) => `${index + 1}. ${item}`).join('\n') : layoutPlan(dataContext),
      '',
      'Phase 4: Automated Analytical Insights',
      `Dynamic comparisons:\n${brief?.comparisons.length ? brief.comparisons.map((item) => `- ${item}`).join('\n') : comparisonPlan(dataContext)}`,
      `Anomaly logic: ${outlierPlan(dataContext)}`,
      '',
      'Phase 5: Visual QA & Misuse Prevention',
      `${visualRationale(dataContext)}\n${brief?.warnings.length ? `\nWarnings:\n${brief.warnings.map((warning) => `- ${warning}`).join('\n')}` : ''}`,
    ].join('\n'),
    layout: { className: 'xl:col-span-2' },
  };
}

function titleForPrompt(prompt: string, dataContext: DashboardDataContext) {
  const promptText = normalise(prompt);
  const sourceBase = dataContext.sourceName.replace(/\.[^.]+$/, '');

  if (promptText.includes('plan') || promptText.includes('architecture')) {
    return `${cleanLabel(sourceBase, 'Dataset')} Analyst Plan`;
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

function bestMetricForPrompt(prompt: string, dataContext: DashboardDataContext, fallback?: AdditiveMetric) {
  const text = normalise(prompt);
  const matches = availableMetrics(dataContext).find((metric) => {
    const sourceColumn = dataContext.metricSlots[metric];
    const label = metricLabel(dataContext, metric);
    return sourceColumn && (text.includes(normalise(sourceColumn)) || text.includes(normalise(label)));
  });

  return matches || fallback;
}

function bestDimensionForPrompt(prompt: string, dataContext: DashboardDataContext, fallback: 'brand' | 'channel') {
  const text = normalise(prompt);
  const dimensions: Array<'brand' | 'channel'> = ['brand', 'channel'];
  return (
    dimensions.find((dimension) => {
      const sourceColumn = dimension === 'brand' ? dataContext.dimensionSlots.primary : dataContext.dimensionSlots.secondary;
      const label = dimensionLabel(dataContext, dimension);
      return sourceColumn && (text.includes(normalise(sourceColumn)) || text.includes(normalise(label)));
    }) || fallback
  );
}

function trendDirectionFromAnomalies(dataContext: DashboardDataContext) {
  const text = dataContext.analystBrief?.anomalies[0]?.toLowerCase() || '';
  return text.includes('below') ? 'down' : 'up';
}

function anomalyNote(dataContext: DashboardDataContext) {
  const anomalies = dataContext.analystBrief?.anomalies || [];
  return anomalies.length ? ` Notable anomaly: ${anomalies[0]}` : '';
}

function kpiRationale(dataContext: DashboardDataContext, metric: AdditiveMetric) {
  const sourceColumn = dataContext.metricSlots[metric];
  const briefKpi = dataContext.analystBrief?.kpis.find((kpi) => kpi.sourceColumn === sourceColumn);
  return briefKpi
    ? `${briefKpi.formula}. ${briefKpi.reason}`
    : `Top-line KPI using ${metricLabel(dataContext, metric)} because it is a reliable numeric measure in the connected dataset.`;
}

function visualReason(type: string, metricLabelText: string, dimensionLabelText?: string) {
  if (type === 'trend') {
    return `Trend over time is shown as a line/area chart because period movement and changes are the question; a category chart would hide timing.`;
  }

  if (type === 'rank') {
    return `${metricLabelText} by ${dimensionLabelText} is shown as a sorted bar ranking because it supports comparison; a pie chart would be harder to read for many categories.`;
  }

  if (type === 'share') {
    return `${metricLabelText} share is shown only because composition was requested and the category count is controlled.`;
  }

  if (type === 'table') {
    return `Table keeps detailed/high-cardinality records inspectable without forcing every field into a crowded visual.`;
  }

  return `Visual selected from the analyst brief to answer a distinct question without duplicating another chart.`;
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

function dashboardDescription(prompt: string, dataContext: DashboardDataContext) {
  const brief = dataContext.analystBrief;
  const metrics = availableMetrics(dataContext).map((metric) => metricLabel(dataContext, metric)).slice(0, 4);
  const filters = [
    dataContext.dimensionSlots.primary ? dimensionLabel(dataContext, 'brand') : null,
    dataContext.dimensionSlots.secondary ? dimensionLabel(dataContext, 'channel') : null,
    dataContext.dimensionSlots.date ? fieldLabel(dataContext, dataContext.dimensionSlots.date, 'Period') : null,
  ].filter(Boolean);

  return [
    `${brief?.domain || inferDomain(dataContext)} from ${dataContext.sourceName}.`,
    `Objective: ${prompt.trim() || 'monitor performance and identify drivers'}.`,
    `Key insights: ${brief?.keyInsights.length ? brief.keyInsights.slice(0, 3).join(' ') : 'insights will be generated from detected measures and dimensions.'}`,
    `Dashboard plan: ${brief?.dashboardPlan.length ? brief.dashboardPlan.slice(0, 3).join(' ') : 'KPI row, driver visuals, then detail table.'}`,
    `Caveats: ${brief?.caveats.length ? brief.caveats.slice(0, 2).join(' ') : 'No major caveats detected.'}`,
    `Grain: ${brief?.grain || dataContext.grain || 'one source row or event record'}.`,
    `KPIs: ${metrics.length ? metrics.join(', ') : 'no reliable numeric KPI detected'}.`,
    `Slicers: ${filters.length ? filters.join(', ') : 'none detected'}.`,
    'Layout follows the inverted pyramid: executive summary first, explanatory trends/drivers next, diagnostic detail last.',
  ].join(' ');
}

export function createDashboardFromDataContext(
  prompt: string,
  currentDashboard: DashboardConfig | undefined,
  dataContext: DashboardDataContext,
) {
  const metrics = availableMetrics(dataContext);
  const promptMetric = bestMetricForPrompt(prompt, dataContext, metrics[0]);
  const primaryMetric = promptMetric || metrics[0];
  const secondaryMetric = metrics[1];
  const hasDate = Boolean(dataContext.dimensionSlots.date);
  const hasPrimaryDimension = hasDimension(dataContext, 'brand');
  const hasSecondaryDimension = hasDimension(dataContext, 'channel');
  const preferredDimension = bestDimensionForPrompt(prompt, dataContext, hasSecondaryDimension ? 'channel' : 'brand');
  const components: DashboardComponentConfig[] = [];

  if (wantsOnlyText(prompt)) {
    return validateDashboardConfig({
      id: currentDashboard?.id || `ai-dashboard-${Date.now()}`,
      title: titleForPrompt(prompt, dataContext),
      description: dashboardDescription(prompt, dataContext),
      filters: [],
      components: [textBox(dataContext, prompt)],
    });
  }

  metrics.slice(0, 4).forEach((metric) => {
    components.push({
      id: `kpi_${metric}`,
      type: 'kpi',
      title: metricLabel(dataContext, metric),
      metric,
      change: kpiRationale(dataContext, metric),
      trend: trendDirectionFromAnomalies(dataContext),
      rationale: kpiRationale(dataContext, metric),
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
      rationale: `Derived ratio KPI. It is shown as a card because rates are non-additive and should not be summed in category charts.`,
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
      rationale: `${visualReason('trend', metricLabel(dataContext, primaryMetric))}${anomalyNote(dataContext)}`,
    });
  }

  if (primaryMetric && hasSecondaryDimension && preferredDimension === 'channel') {
    components.push({
      id: `${primaryMetric}_by_secondary_dimension`,
      type: 'horizontal_bar_chart',
      title: `${metricLabel(dataContext, primaryMetric)} by ${dimensionLabel(dataContext, 'channel')}`,
      dataSource: 'channel',
      xAxis: primaryMetric,
      yAxis: 'channel',
      color: colours[1],
      rationale: visualReason('rank', metricLabel(dataContext, primaryMetric), dimensionLabel(dataContext, 'channel')),
    });
  }

  if ((secondaryMetric || primaryMetric) && hasPrimaryDimension) {
    const metric = preferredDimension === 'brand' ? primaryMetric : secondaryMetric || primaryMetric;
    components.push({
      id: `${metric}_by_primary_dimension`,
      type: 'bar_chart',
      title: `${metricLabel(dataContext, metric)} by ${dimensionLabel(dataContext, 'brand')}`,
      dataSource: 'brand',
      xAxis: 'brand',
      yAxis: metric,
      color: colours[0],
      rationale: visualReason('rank', metricLabel(dataContext, metric), dimensionLabel(dataContext, 'brand')),
    });
  }

  if (primaryMetric && hasSecondaryDimension && preferredDimension === 'brand') {
    components.push({
      id: `${primaryMetric}_by_secondary_dimension`,
      type: 'horizontal_bar_chart',
      title: `${metricLabel(dataContext, primaryMetric)} by ${dimensionLabel(dataContext, 'channel')}`,
      dataSource: 'channel',
      xAxis: primaryMetric,
      yAxis: 'channel',
      color: colours[1],
      rationale: visualReason('rank', metricLabel(dataContext, primaryMetric), dimensionLabel(dataContext, 'channel')),
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
      rationale: visualReason('share', metricLabel(dataContext, primaryMetric), dimensionLabel(dataContext, 'channel')),
    });
  }

  if (hasDate && metrics.length >= 2) {
    components.push({
      id: 'period_intensity',
      type: 'heatmap',
      title: 'Measure Intensity by Period',
      dataSource: 'monthly',
      metrics: metrics.slice(0, 4),
      rationale: `Heatmap is used as a compact diagnostic layer to compare multiple measures by period and spot unusual intensity.`,
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
      rationale: visualReason('table', metricLabel(dataContext, primaryMetric || metrics[0] || 'leads'), dimensionLabel(dataContext, dimension)),
    });
  }

  return validateDashboardConfig({
    id: currentDashboard?.id || `ai-dashboard-${Date.now()}`,
    title: titleForPrompt(prompt, dataContext),
    description: dashboardDescription(prompt, dataContext),
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
