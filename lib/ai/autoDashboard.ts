import { validateDashboardConfig } from '@/lib/ai/dashboardSchema';
import type { ImportedDataset } from '@/lib/data/importData';
import type { DashboardConfig } from '@/types/dashboard';

function cleanLabel(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function createDashboardFromImportedDataset(imported: ImportedDataset): DashboardConfig {
  const primaryDimension = cleanLabel(imported.mappedColumns.brand, 'Primary Dimension');
  const secondaryDimension = cleanLabel(imported.mappedColumns.channel, 'Secondary Dimension');
  const primaryMeasure = cleanLabel(imported.mappedColumns.leads, 'Primary Volume');
  const qualifiedMeasure = cleanLabel(imported.mappedColumns.valuations, 'Qualified Records');
  const activityMeasure = cleanLabel(imported.mappedColumns.sessions, 'Activity Volume');
  const outcomeMeasure = cleanLabel(imported.mappedColumns.bookings, 'Completed Outcomes');
  const primaryDimensionCount = new Set(imported.rows.map((row) => row.brand)).size;
  const secondaryDimensionCount = new Set(imported.rows.map((row) => row.channel)).size;
  const hasPrimaryDimension = Boolean(imported.mappedColumns.brand) && primaryDimensionCount > 1;
  const hasSecondaryDimension = Boolean(imported.mappedColumns.channel) && secondaryDimensionCount > 1;
  const shouldShowSecondaryShare = secondaryDimensionCount > 1 && secondaryDimensionCount <= 5;
  const shouldShowPrimaryShare = primaryDimensionCount > 1 && primaryDimensionCount <= 5;

  return validateDashboardConfig({
    id: `uploaded-${Date.now()}`,
    title: 'Data Performance Overview',
    description: `Generated from ${imported.fileName}. Assumption: this dashboard is for an operations or analyst audience reviewing performance and drivers; it leads with headline measures, then explains movement and category differences, then provides detail for follow-up.`,
    filters: [
      { id: 'brand_filter', type: 'select_filter', field: 'brand', title: primaryDimension },
      { id: 'channel_filter', type: 'select_filter', field: 'channel', title: secondaryDimension },
      { id: 'date_filter', type: 'date_filter', field: 'month', title: 'Period' },
    ],
    components: [
      {
        id: 'kpi_primary_volume',
        type: 'kpi',
        title: primaryMeasure,
        metric: 'leads',
        change: 'Active dataset total',
        trend: 'up',
      },
      {
        id: 'kpi_qualified_records',
        type: 'kpi',
        title: qualifiedMeasure,
        metric: 'valuations',
        change: 'Mapped measure',
        trend: 'up',
      },
      {
        id: 'kpi_completed_outcomes',
        type: 'kpi',
        title: outcomeMeasure,
        metric: 'bookings',
        change: 'Mapped outcome measure',
        trend: 'up',
      },
      {
        id: 'kpi_completion_rate',
        type: 'kpi',
        title: 'Outcome Rate',
        metric: 'conversionRate',
        change: 'Non-additive: recalculated after filters',
        trend: 'up',
      },
      {
        id: 'trend_core_measures',
        type: 'area_chart',
        title: 'Core Measures by Period',
        dataSource: 'monthly',
        xAxis: 'month',
        layout: { className: 'xl:col-span-2' },
        series: [
          { metric: 'leads', label: primaryMeasure, color: '#1f7a8c' },
          { metric: 'valuations', label: qualifiedMeasure, color: '#d88c36' },
          { metric: 'bookings', label: outcomeMeasure, color: '#4f7f52' },
        ],
      },
      {
        id: 'activity_trend',
        type: 'line_chart',
        title: `${activityMeasure} Trend`,
        dataSource: 'monthly',
        xAxis: 'month',
        series: [
          { metric: 'sessions', label: activityMeasure, color: '#7c3aed' },
        ],
      },
      ...(hasSecondaryDimension
        ? [
            {
              id: 'primary_by_secondary_dimension',
              type: 'horizontal_bar_chart' as const,
              title: `Top ${secondaryDimension} by ${primaryMeasure}`,
              dataSource: 'channel' as const,
              xAxis: 'leads' as const,
              yAxis: 'channel' as const,
              color: '#7c3aed',
            },
            {
              id: 'outcomes_by_secondary_dimension',
              type: 'horizontal_bar_chart' as const,
              title: `Top ${secondaryDimension} by ${outcomeMeasure}`,
              dataSource: 'channel' as const,
              xAxis: 'bookings' as const,
              yAxis: 'channel' as const,
              color: '#4f7f52',
            },
          ]
        : []),
      ...(hasPrimaryDimension
        ? [
            {
              id: 'qualified_by_primary_dimension',
              type: 'bar_chart' as const,
              title: `${qualifiedMeasure} by ${primaryDimension}`,
              dataSource: 'brand' as const,
              xAxis: 'brand' as const,
              yAxis: 'valuations' as const,
              color: '#1f7a8c',
            },
          ]
        : []),
      {
        id: 'period_heatmap',
        type: 'heatmap',
        title: 'Measure Intensity by Period',
        dataSource: 'monthly',
        metrics: ['leads', 'valuations', 'sessions', 'bookings'],
      },
      ...(hasSecondaryDimension && shouldShowSecondaryShare
        ? [
            {
              id: 'composition_secondary_dimension',
              type: 'pie_chart' as const,
              title: `${primaryMeasure} Share by ${secondaryDimension}`,
              dataSource: 'channel' as const,
              nameKey: 'channel' as const,
              valueKey: 'leads' as const,
            },
          ]
        : []),
      ...(hasPrimaryDimension && shouldShowPrimaryShare
        ? [
            {
              id: 'composition_primary_dimension',
              type: 'pie_chart' as const,
              title: `${qualifiedMeasure} Share by ${primaryDimension}`,
              dataSource: 'brand' as const,
              nameKey: 'brand' as const,
              valueKey: 'valuations' as const,
            },
          ]
        : []),
      ...(hasSecondaryDimension
        ? [
            {
              id: 'secondary_dimension_table',
              type: 'data_table' as const,
              title: `${secondaryDimension} Performance`,
              dataSource: 'channel' as const,
              columns: [
                { key: 'channel', label: secondaryDimension },
                { key: 'leads', label: primaryMeasure },
                { key: 'valuations', label: qualifiedMeasure },
                { key: 'sessions', label: activityMeasure },
                { key: 'bookings', label: outcomeMeasure },
              ],
            },
          ]
        : []),
      ...(hasPrimaryDimension
        ? [
            {
              id: 'primary_dimension_table',
              type: 'data_table' as const,
              title: `${primaryDimension} Performance`,
              dataSource: 'brand' as const,
              columns: [
                { key: 'brand', label: primaryDimension },
                { key: 'leads', label: primaryMeasure },
                { key: 'valuations', label: qualifiedMeasure },
                { key: 'sessions', label: activityMeasure },
                { key: 'bookings', label: outcomeMeasure },
              ],
            },
          ]
        : []),
      {
        id: 'period_table',
        type: 'data_table',
        title: 'Period Performance',
        dataSource: 'monthly',
        columns: [
          { key: 'month', label: 'Period' },
          { key: 'leads', label: primaryMeasure },
          { key: 'valuations', label: qualifiedMeasure },
          { key: 'sessions', label: activityMeasure },
          { key: 'bookings', label: outcomeMeasure },
        ],
      },
    ],
  });
}
