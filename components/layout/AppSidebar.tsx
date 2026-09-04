import { BarChart3, ChevronsLeft, ChevronsRight, LayoutDashboard, Palette, Plus, Settings, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type AppSidebarProps = {
  isCollapsed: boolean;
  onToggle: () => void;
  currentDashboardTitle: string;
  dashboards: Array<{ id: string; name: string; status: string }>;
  activeDashboardId: string;
  activeTheme: 'light' | 'dark' | 'midnight';
  onAddDashboard: () => void;
  onSelectDashboard: (id: string) => void;
  onThemeChange: (theme: 'light' | 'dark' | 'midnight') => void;
};

export function AppSidebar({
  activeDashboardId,
  currentDashboardTitle,
  dashboards,
  isCollapsed,
  activeTheme,
  onAddDashboard,
  onSelectDashboard,
  onThemeChange,
  onToggle,
}: AppSidebarProps) {
  return (
    <aside
      className={cn(
        'flex min-h-screen w-full flex-col border-r border-slate-200 bg-white px-4 py-4 transition-all',
        isCollapsed && 'items-center px-3',
      )}
    >
      <div className={cn('flex w-full items-center gap-3', isCollapsed && 'justify-center')}>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className={cn(isCollapsed && 'hidden')}>
          <p className="text-sm font-semibold">DashForge AI</p>
          <p className="text-xs text-muted-foreground">Universal dashboard builder</p>
        </div>
      </div>

      <Button
        className={cn('mt-4 w-full', isCollapsed && 'h-9 w-9 px-0')}
        onClick={onToggle}
        size={isCollapsed ? 'icon' : 'default'}
        variant="outline"
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        {!isCollapsed && 'Minimise sidebar'}
      </Button>

      <div className={cn('mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3', isCollapsed && 'hidden')}>
        <p className="text-xs font-medium uppercase text-muted-foreground">Current Dashboard</p>
        <h2 className="mt-2 text-base font-semibold">{currentDashboardTitle}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Prompt-driven analytics canvas with local saves and uploaded data.
        </p>
      </div>

      <nav className={cn('mt-5 grid gap-1 text-sm', isCollapsed && 'w-full justify-items-center')}>
        <Button className={cn('justify-start', isCollapsed && 'h-9 w-9 px-0')} variant="secondary" aria-label="Builder">
          <LayoutDashboard className="h-4 w-4" />
          {!isCollapsed && 'Builder'}
        </Button>
        <Button className={cn('justify-start text-muted-foreground', isCollapsed && 'h-9 w-9 px-0')} variant="ghost" aria-label="Dashboards">
          <BarChart3 className="h-4 w-4" />
          {!isCollapsed && 'Dashboards'}
        </Button>
        <Button className={cn('justify-start text-muted-foreground', isCollapsed && 'h-9 w-9 px-0')} variant="ghost" aria-label="Settings">
          <Settings className="h-4 w-4" />
          {!isCollapsed && 'Settings'}
        </Button>
      </nav>

      <div className={cn('mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3', isCollapsed && 'hidden')}>
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          <Palette className="h-4 w-4" />
          Theme
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-md bg-white p-1">
          {(['light', 'dark', 'midnight'] as const).map((theme) => (
            <button
              className={cn(
                'rounded px-2 py-1.5 text-xs font-medium capitalize text-muted-foreground transition hover:bg-muted hover:text-foreground',
                activeTheme === theme && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
              )}
              key={theme}
              onClick={() => onThemeChange(theme)}
              type="button"
            >
              {theme}
            </button>
          ))}
        </div>
      </div>

      <div className={cn('mt-6 flex items-center justify-between', isCollapsed && 'hidden')}>
        <p className="text-xs font-semibold uppercase text-muted-foreground">Saved Dashboards</p>
        <Button size="icon" variant="outline" aria-label="Add dashboard" onClick={onAddDashboard}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className={cn('mt-3 grid gap-2', isCollapsed && 'hidden')}>
        {dashboards.map((dashboard) => (
          <button
            className={cn(
              'rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-primary/40 hover:bg-white hover:shadow-sm',
              dashboard.id === activeDashboardId && 'border-primary/50 bg-primary/5',
            )}
            key={dashboard.id}
            onClick={() => onSelectDashboard(dashboard.id)}
          >
            <span className="block text-sm font-medium">{dashboard.name}</span>
            <Badge className="mt-2">{dashboard.status}</Badge>
          </button>
        ))}
      </div>
    </aside>
  );
}
