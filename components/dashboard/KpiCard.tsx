import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type KpiCardProps = {
  title: string;
  value: string;
  change: string;
  trend?: 'up' | 'down';
  icon: LucideIcon;
};

export function KpiCard({ title, value, change, trend = 'up', icon: Icon }: KpiCardProps) {
  const TrendIcon = trend === 'up' ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="group min-w-0 overflow-hidden shadow-none transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase text-muted-foreground">{title}</p>
            <p className="mt-3 break-words text-[clamp(1.45rem,1.8vw,1.7rem)] font-semibold leading-none tracking-normal text-foreground">
              {value}
            </p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <Badge
          className={cn(
            'mt-4 max-w-full border-0',
            trend === 'up' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground',
          )}
        >
          <TrendIcon className="mr-1 h-3.5 w-3.5" />
          <span className="truncate">{change}</span>
        </Badge>
      </CardContent>
    </Card>
  );
}
