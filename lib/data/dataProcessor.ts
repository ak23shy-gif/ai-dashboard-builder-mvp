import type { MarketingRow } from '@/lib/data/mockData';

export type DashboardFilters = {
  brand: string;
  channel: string;
  startMonth: number;
  endMonth: number;
};

export type KpiSummary = {
  leads: number;
  valuations: number;
  sessions: number;
  bookings: number;
  conversionRate: number;
};

export function filterMarketingData(rows: MarketingRow[], filters: DashboardFilters) {
  return rows.filter((row) => {
    const brandMatches = filters.brand === 'All' || row.brand === filters.brand;
    const channelMatches = filters.channel === 'All' || row.channel === filters.channel;
    const monthMatches = row.monthIndex >= filters.startMonth && row.monthIndex <= filters.endMonth;

    return brandMatches && channelMatches && monthMatches;
  });
}

export function summarizeMarketingData(rows: MarketingRow[]): KpiSummary {
  const totals = rows.reduce(
    (acc, row) => {
      acc.leads += row.leads;
      acc.valuations += row.valuations;
      acc.sessions += row.sessions;
      acc.bookings += row.bookings;
      return acc;
    },
    { leads: 0, valuations: 0, sessions: 0, bookings: 0 },
  );

  return {
    ...totals,
    conversionRate: totals.leads ? Number(((totals.bookings / totals.leads) * 100).toFixed(1)) : 0,
  };
}

export function groupByMonth(rows: MarketingRow[]) {
  return Array.from(aggregateRows(rows, 'month').entries())
    .map(([month, totals]) => ({
      month,
      ...totals,
    }))
    .sort((a, b) => a.monthIndex - b.monthIndex);
}

export function groupByChannel(rows: MarketingRow[]) {
  return Array.from(aggregateRows(rows, 'channel').entries())
    .map(([channel, totals]) => ({
      channel,
      ...totals,
    }))
    .sort((a, b) => b.leads - a.leads);
}

export function groupByBrand(rows: MarketingRow[]) {
  return Array.from(aggregateRows(rows, 'brand').entries())
    .map(([brand, totals]) => ({
      brand,
      ...totals,
    }))
    .sort((a, b) => b.valuations - a.valuations);
}

export function topDimensionValues(rows: MarketingRow[], key: 'brand' | 'channel', limit = 100) {
  return Array.from(aggregateRows(rows, key).entries())
    .sort(([, a], [, b]) => b.leads - a.leads)
    .slice(0, limit)
    .map(([value]) => value);
}

function aggregateRows<K extends keyof MarketingRow>(rows: MarketingRow[], key: K) {
  return rows.reduce((groups, row) => {
    const groupKey = String(row[key]);
    const totals = groups.get(groupKey) ?? {
      monthIndex: row.monthIndex,
      leads: 0,
      valuations: 0,
      sessions: 0,
      bookings: 0,
    };

    totals.monthIndex = Math.min(totals.monthIndex, row.monthIndex);
    totals.leads += row.leads;
    totals.valuations += row.valuations;
    totals.sessions += row.sessions;
    totals.bookings += row.bookings;
    groups.set(groupKey, totals);
    return groups;
  }, new Map<string, { monthIndex: number; leads: number; valuations: number; sessions: number; bookings: number }>());
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-GB').format(value);
}

export function formatCompactNumber(value: number) {
  const absoluteValue = Math.abs(value);

  if (absoluteValue < 10000) {
    return new Intl.NumberFormat('en-GB').format(value);
  }

  return new Intl.NumberFormat('en-GB', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: absoluteValue >= 100000 ? 0 : 1,
  }).format(value);
}

export function formatDashboardValue(value: string | number) {
  if (typeof value !== 'number') {
    return value;
  }

  return formatCompactNumber(value);
}
