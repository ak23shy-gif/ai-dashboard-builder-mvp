export const brands = ['Nurtur', 'Starberry', 'BriefYourMarket', 'Yomdel', 'TPJ'] as const;

export const channels = [
  'Organic Search',
  'Paid Search',
  'Social',
  'Email',
  'Referral',
  'Direct',
] as const;

export type MarketingRow = {
  date: string;
  month: string;
  monthIndex: number;
  year: number;
  brand: string;
  channel: string;
  leads: number;
  valuations: number;
  sessions: number;
  bookings: number;
};

const months = [
  ['Jan', 1],
  ['Feb', 2],
  ['Mar', 3],
  ['Apr', 4],
  ['May', 5],
  ['Jun', 6],
  ['Jul', 7],
  ['Aug', 8],
  ['Sep', 9],
  ['Oct', 10],
  ['Nov', 11],
  ['Dec', 12],
] as const;

const brandWeight = {
  Nurtur: 1.14,
  Starberry: 0.96,
  BriefYourMarket: 0.88,
  Yomdel: 1.05,
  TPJ: 0.72,
};

const channelWeight = {
  'Organic Search': 1.24,
  'Paid Search': 1.12,
  Social: 0.74,
  Email: 0.82,
  Referral: 0.68,
  Direct: 0.91,
};

export const marketingData: MarketingRow[] = months.flatMap(([month, monthIndex]) =>
  brands.flatMap((brand, brandIndex) =>
    channels.map((channel, channelIndex) => {
      const seasonal = 1 + Math.sin((monthIndex / 12) * Math.PI) * 0.28;
      const base = 620 * brandWeight[brand] * channelWeight[channel] * seasonal;
      const variance = 1 + ((brandIndex * 7 + channelIndex * 5 + monthIndex * 3) % 13) / 45;
      const sessions = Math.round(base * variance * 16);
      const leads = Math.round(sessions * (0.045 + channelIndex * 0.003 + brandIndex * 0.002));
      const valuations = Math.round(leads * (0.31 + brandIndex * 0.012));
      const bookings = Math.round(valuations * (0.21 + channelIndex * 0.008));

      return {
        date: `2026-${String(monthIndex).padStart(2, '0')}-01`,
        month,
        monthIndex,
        year: 2026,
        brand,
        channel,
        leads,
        valuations,
        sessions,
        bookings,
      };
    }),
  ),
);
