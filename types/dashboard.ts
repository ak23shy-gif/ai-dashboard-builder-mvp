export type DashboardComponentType =
  | 'kpi'
  | 'line_chart'
  | 'area_chart'
  | 'bar_chart'
  | 'horizontal_bar_chart'
  | 'pie_chart'
  | 'gauge'
  | 'funnel'
  | 'heatmap'
  | 'data_table'
  | 'date_filter'
  | 'select_filter';

export type DashboardDataSource = 'summary' | 'monthly' | 'channel' | 'brand';

export type DashboardMetric = 'leads' | 'valuations' | 'sessions' | 'bookings' | 'conversionRate';

export type DashboardDimension = 'month' | 'channel' | 'brand';

export interface DashboardConfig {
  id: string;
  title: string;
  description?: string;
  filters?: DashboardFilterConfig[];
  components: DashboardComponentConfig[];
}

export type DashboardComponentConfig =
  | KpiComponentConfig
  | LineChartComponentConfig
  | AreaChartComponentConfig
  | BarChartComponentConfig
  | HorizontalBarChartComponentConfig
  | PieChartComponentConfig
  | GaugeComponentConfig
  | FunnelComponentConfig
  | HeatmapComponentConfig
  | DataTableComponentConfig;

export interface BaseDashboardComponentConfig {
  id: string;
  type: DashboardComponentType;
  title: string;
  dataSource?: DashboardDataSource;
  layout?: {
    className?: string;
  };
}

export interface KpiComponentConfig extends BaseDashboardComponentConfig {
  type: 'kpi';
  metric: DashboardMetric;
  change?: string;
  trend?: 'up' | 'down';
}

export interface LineChartComponentConfig extends BaseDashboardComponentConfig {
  type: 'line_chart';
  dataSource: 'monthly';
  xAxis: DashboardDimension;
  series: Array<{
    metric: Exclude<DashboardMetric, 'conversionRate'>;
    label: string;
    color: string;
  }>;
}

export interface AreaChartComponentConfig extends BaseDashboardComponentConfig {
  type: 'area_chart';
  dataSource: 'monthly';
  xAxis: DashboardDimension;
  series: Array<{
    metric: Exclude<DashboardMetric, 'conversionRate'>;
    label: string;
    color: string;
  }>;
}

export interface BarChartComponentConfig extends BaseDashboardComponentConfig {
  type: 'bar_chart';
  dataSource: 'channel' | 'brand';
  xAxis: 'channel' | 'brand';
  yAxis: Exclude<DashboardMetric, 'conversionRate'>;
  color?: string;
}

export interface HorizontalBarChartComponentConfig extends BaseDashboardComponentConfig {
  type: 'horizontal_bar_chart';
  dataSource: 'channel' | 'brand';
  xAxis: Exclude<DashboardMetric, 'conversionRate'>;
  yAxis: 'channel' | 'brand';
  color?: string;
}

export interface PieChartComponentConfig extends BaseDashboardComponentConfig {
  type: 'pie_chart';
  dataSource: 'channel' | 'brand';
  nameKey: 'channel' | 'brand';
  valueKey: Exclude<DashboardMetric, 'conversionRate'>;
}

export interface GaugeComponentConfig extends BaseDashboardComponentConfig {
  type: 'gauge';
  metric: DashboardMetric;
  target?: number;
}

export interface FunnelComponentConfig extends BaseDashboardComponentConfig {
  type: 'funnel';
  dataSource: 'summary';
  stages: Array<{
    metric: Exclude<DashboardMetric, 'conversionRate'>;
    label: string;
    color: string;
  }>;
}

export interface HeatmapComponentConfig extends BaseDashboardComponentConfig {
  type: 'heatmap';
  dataSource: 'monthly';
  metrics: Array<Exclude<DashboardMetric, 'conversionRate'>>;
}

export interface DataTableComponentConfig extends BaseDashboardComponentConfig {
  type: 'data_table';
  dataSource: 'channel' | 'brand' | 'monthly';
  columns: Array<{
    key: string;
    label: string;
  }>;
}

export interface DashboardFilterConfig {
  id: string;
  type: 'date_filter' | 'select_filter';
  field: 'brand' | 'channel' | 'month';
  title: string;
}
