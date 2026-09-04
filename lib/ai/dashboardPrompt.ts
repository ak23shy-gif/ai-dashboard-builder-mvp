import type { DashboardConfig } from '@/types/dashboard';

export const dashboardJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['dashboard'],
  properties: {
    dashboard: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'title', 'description', 'filters', 'components'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'field', 'title'],
            properties: {
              id: { type: 'string' },
              type: { enum: ['date_filter', 'select_filter'] },
              field: { enum: ['brand', 'channel', 'month'] },
              title: { type: 'string' },
            },
          },
        },
        components: {
          type: 'array',
          minItems: 1,
          items: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'title', 'metric', 'change', 'trend'],
                properties: {
                  id: { type: 'string' },
                  type: { const: 'kpi' },
                  title: { type: 'string' },
                  metric: { enum: ['leads', 'valuations', 'sessions', 'bookings', 'conversionRate'] },
                  change: { type: 'string' },
                  trend: { enum: ['up', 'down'] },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'title', 'dataSource', 'xAxis', 'series'],
                properties: {
                  id: { type: 'string' },
                  type: { const: 'line_chart' },
                  title: { type: 'string' },
                  dataSource: { const: 'monthly' },
                  xAxis: { const: 'month' },
                  series: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['metric', 'label', 'color'],
                      properties: {
                        metric: { enum: ['leads', 'valuations', 'sessions', 'bookings'] },
                        label: { type: 'string' },
                        color: { type: 'string' },
                      },
                    },
                  },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'title', 'dataSource', 'xAxis', 'series'],
                properties: {
                  id: { type: 'string' },
                  type: { const: 'area_chart' },
                  title: { type: 'string' },
                  dataSource: { const: 'monthly' },
                  xAxis: { const: 'month' },
                  series: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['metric', 'label', 'color'],
                      properties: {
                        metric: { enum: ['leads', 'valuations', 'sessions', 'bookings'] },
                        label: { type: 'string' },
                        color: { type: 'string' },
                      },
                    },
                  },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'title', 'dataSource', 'xAxis', 'yAxis', 'color'],
                properties: {
                  id: { type: 'string' },
                  type: { const: 'bar_chart' },
                  title: { type: 'string' },
                  dataSource: { enum: ['channel', 'brand'] },
                  xAxis: { enum: ['channel', 'brand'] },
                  yAxis: { enum: ['leads', 'valuations', 'sessions', 'bookings'] },
                  color: { type: 'string' },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'title', 'dataSource', 'xAxis', 'yAxis', 'color'],
                properties: {
                  id: { type: 'string' },
                  type: { const: 'horizontal_bar_chart' },
                  title: { type: 'string' },
                  dataSource: { enum: ['channel', 'brand'] },
                  xAxis: { enum: ['leads', 'valuations', 'sessions', 'bookings'] },
                  yAxis: { enum: ['channel', 'brand'] },
                  color: { type: 'string' },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'title', 'dataSource', 'nameKey', 'valueKey'],
                properties: {
                  id: { type: 'string' },
                  type: { const: 'pie_chart' },
                  title: { type: 'string' },
                  dataSource: { enum: ['channel', 'brand'] },
                  nameKey: { enum: ['channel', 'brand'] },
                  valueKey: { enum: ['leads', 'valuations', 'sessions', 'bookings'] },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'title', 'metric', 'target'],
                properties: {
                  id: { type: 'string' },
                  type: { const: 'gauge' },
                  title: { type: 'string' },
                  metric: { enum: ['leads', 'valuations', 'sessions', 'bookings', 'conversionRate'] },
                  target: { type: 'number' },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'title', 'dataSource', 'stages'],
                properties: {
                  id: { type: 'string' },
                  type: { const: 'funnel' },
                  title: { type: 'string' },
                  dataSource: { const: 'summary' },
                  stages: {
                    type: 'array',
                    minItems: 2,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['metric', 'label', 'color'],
                      properties: {
                        metric: { enum: ['leads', 'valuations', 'sessions', 'bookings'] },
                        label: { type: 'string' },
                        color: { type: 'string' },
                      },
                    },
                  },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'title', 'dataSource', 'metrics'],
                properties: {
                  id: { type: 'string' },
                  type: { const: 'heatmap' },
                  title: { type: 'string' },
                  dataSource: { const: 'monthly' },
                  metrics: {
                    type: 'array',
                    minItems: 2,
                    items: { enum: ['leads', 'valuations', 'sessions', 'bookings'] },
                  },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'title', 'dataSource', 'columns'],
                properties: {
                  id: { type: 'string' },
                  type: { const: 'data_table' },
                  title: { type: 'string' },
                  dataSource: { enum: ['channel', 'brand', 'monthly'] },
                  columns: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['key', 'label'],
                      properties: {
                        key: { type: 'string' },
                        label: { type: 'string' },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  },
};

export function buildDashboardSystemPrompt() {
  return `
You are a Senior Data Analyst and Dashboard Architect with 10+ years of experience translating business questions into decision-ready dashboards.
Return only a structured Dashboard JSON configuration. Do not return HTML, React code, SQL or Markdown.
Do not default to "add a chart for every column". Every visual must answer a specific stakeholder question.

Dashboard planning process:
1. Clarify purpose. If the user does not provide audience, decision, cadence or the single most important question, proceed with explicit assumptions inside the dashboard description.
2. Define the narrative before layout. Use a clear reading order: headline KPIs at the top, explanatory trends/breakdowns in the middle, diagnostic detail at the bottom.
3. Choose visuals by intent, not habit:
   - Trend over time: line_chart or area_chart.
   - Comparison across categories: bar_chart or horizontal_bar_chart, sorted by value.
   - Part-to-whole: pie_chart only when there are 5 or fewer categories and share is the actual question.
   - Single critical number: kpi. Use gauge only when a target/progress threshold is explicitly required.
   - Operational lookup/detail: data_table.
   - Period intensity: heatmap only when comparing multiple measures across time is useful.
   - Do not use a chart where a KPI/card is clearer.
   - Use tables for detailed or high-cardinality data.
4. Apply design discipline:
   - Use color to encode meaning, not decoration.
   - Prefer one accent color and neutral context colors.
   - Avoid redundant legends, chart junk and repetitive visuals.
   - Do not include a visual if you cannot justify its purpose.
   - Keep layouts clean, aligned, responsive and uncluttered.
   - Make important KPIs visually prominent.
5. Validate against misuse:
   - Be careful with rates and ratios like conversionRate; do not imply they are additive.
   - Avoid misleading visuals such as unnecessary pie charts, decorative gauges, or truncated comparisons.
   - Keep high-cardinality dimensions in ranked bars or tables, not crowded pies.
   - Never use ID, key, hash, code, SKU, reference or internal database columns as summed measures or default chart axes.
6. Deliver a dashboard that enables decisions, not a grid of everything measurable.

Formatting and semantic rules:
- Do not display IDs with units. IDs should remain plain numbers/text and should normally be hidden from visuals.
- Format large additive numbers automatically, for example 1,250, 25K, 2.5M or 1.2B.
- Never show unnecessary decimal places; use 25 instead of 25.00.
- Use percentages for percentage/rate metrics.
- Use currency symbols for monetary values such as sales, revenue, amount, cost, profit, price, spend or budget.
- Use readable chart titles based on clean column/metric names, not raw database names.
- Do not truncate important labels unnecessarily.
- Sort rankings logically, usually highest-to-lowest.
- Use date fields intelligently for time trends and avoid raw timestamp category charts.
- Do not assume marketing or sales. Let the available data determine the dashboard structure.

Available component types:
- kpi
- line_chart
- area_chart
- bar_chart
- horizontal_bar_chart
- pie_chart
- gauge
- funnel
- heatmap
- data_table

Available metrics:
- leads
- valuations
- sessions
- bookings
- conversionRate

Available dimensions:
- month
- channel
- brand

Available filters:
- brand select filter
- channel select filter
- month date range filter

Available data fields:
- date
- month
- year
- brand
- channel
- leads
- valuations
- sessions
- bookings

Supported brands:
- Nurtur
- Starberry
- BriefYourMarket
- Yomdel
- TPJ

Supported channels:
- Organic Search
- Paid Search
- Social
- Email
- Referral
- Direct

If the user asks to update an existing dashboard, modify the current dashboard instead of creating an unrelated one.
Keep component IDs stable when editing existing components.
Use clear business-friendly titles.
Use a professional BI layout: KPI cards first, then trend and ranked comparisons, then diagnostic table/details.
Do not create repetitive charts that show the same metric/dimension combination.
Avoid gauges and pie/donut charts unless the user's intent clearly calls for them.
`.trim();
}

export function buildDashboardUserPrompt(prompt: string, currentDashboard?: DashboardConfig) {
  return JSON.stringify(
    {
      instruction: prompt,
      currentDashboard: currentDashboard || null,
    },
    null,
    2,
  );
}
