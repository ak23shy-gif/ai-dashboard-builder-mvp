'use client';

import { useEffect, useMemo, useState } from 'react';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { DashboardCanvas } from '@/components/dashboard/DashboardCanvas';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { createDashboardFromImportedDataset } from '@/lib/ai/autoDashboard';
import { defaultDashboardConfig, validateDashboardConfig } from '@/lib/ai/dashboardSchema';
import { marketingData, type MarketingRow } from '@/lib/data/mockData';
import type { DashboardComponentConfig, DashboardConfig } from '@/types/dashboard';

type SavedDashboard = {
  id: string;
  name: string;
  status: string;
  dashboard: DashboardConfig;
};

const storageKey = 'dashforge-ai-dashboards';
const themeStorageKey = 'dashforge-ai-theme';
type AppTheme = 'light' | 'dark' | 'midnight';

function createInitialDashboards(): SavedDashboard[] {
  const defaultDashboard = validateDashboardConfig(defaultDashboardConfig);

  return [
    { id: defaultDashboard.id, name: defaultDashboard.title, status: 'Saved', dashboard: defaultDashboard },
    {
      id: 'completion-overview',
      name: 'Completion Overview',
      status: 'Saved',
      dashboard: validateDashboardConfig({
        ...defaultDashboard,
        id: 'completion-overview',
        title: 'Completion Overview',
        description: 'Saved dashboard focused on completion activity and conversion rate.',
        components: defaultDashboard.components.filter((component) =>
          ['kpi_total_leads', 'kpi_bookings', 'kpi_conversion_rate', 'monthly_performance', 'channel_share'].includes(component.id),
        ),
      }),
    },
    {
      id: 'activity-overview',
      name: 'Activity Overview',
      status: 'Saved',
      dashboard: validateDashboardConfig({
        ...defaultDashboard,
        id: 'activity-overview',
        title: 'Activity Overview',
        description: 'Saved dashboard focused on activity volume and trend performance.',
      }),
    },
  ];
}

export function DashboardBuilderShell() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [dashboards, setDashboards] = useState<SavedDashboard[]>(createInitialDashboards);
  const [activeDashboardId, setActiveDashboardId] = useState(() => validateDashboardConfig(defaultDashboardConfig).id);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [dataRows, setDataRows] = useState<MarketingRow[]>(marketingData);
  const [sourceLabel, setSourceLabel] = useState('Sample data');
  const [activeTheme, setActiveTheme] = useState<AppTheme>('light');

  const dashboardConfig = useMemo(
    () => dashboards.find((dashboard) => dashboard.id === activeDashboardId)?.dashboard || validateDashboardConfig(defaultDashboardConfig),
    [activeDashboardId, dashboards],
  );

  useEffect(() => {
    const storedDashboards = window.localStorage.getItem(storageKey);
    const storedTheme = window.localStorage.getItem(themeStorageKey) as AppTheme | null;

    if (storedTheme && ['light', 'dark', 'midnight'].includes(storedTheme)) {
      setActiveTheme(storedTheme);
    }

    if (storedDashboards) {
      try {
        const parsed = JSON.parse(storedDashboards) as SavedDashboard[];
        if (Array.isArray(parsed) && parsed.length) {
          const nextDashboards = parsed.map((dashboard) => ({
            ...dashboard,
            dashboard: validateDashboardConfig(dashboard.dashboard),
          }));
          setDashboards(nextDashboards);
          setActiveDashboardId(nextDashboards[0].id);
        }
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }

    setHasLoadedStorage(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;

    if (hasLoadedStorage) {
      window.localStorage.setItem(themeStorageKey, activeTheme);
    }
  }, [activeTheme, hasLoadedStorage]);

  useEffect(() => {
    if (hasLoadedStorage) {
      window.localStorage.setItem(storageKey, JSON.stringify(dashboards));
    }
  }, [dashboards, hasLoadedStorage]);

  function saveDashboard(nextDashboard: DashboardConfig, status = 'Saved') {
    const validated = validateDashboardConfig({
      ...nextDashboard,
      id: activeDashboardId,
    });

    setDashboards((currentDashboards) =>
      currentDashboards.map((dashboard) =>
        dashboard.id === activeDashboardId
          ? { ...dashboard, name: validated.title, status, dashboard: validated }
          : dashboard,
      ),
    );
  }

  function handleAddDashboard() {
    const id = `dashboard-${Date.now()}`;
    const dashboard = validateDashboardConfig({
      ...defaultDashboardConfig,
      id,
      title: 'New Dashboard',
      description: 'Draft dashboard ready for AI generation or manual editing.',
    });

    setDashboards((currentDashboards) => [
      { id, name: dashboard.title, status: 'Draft', dashboard },
      ...currentDashboards,
    ]);
    setActiveDashboardId(id);
  }

  function handleUpdateComponent(componentId: string, updater: (component: DashboardComponentConfig) => DashboardComponentConfig) {
    saveDashboard({
      ...dashboardConfig,
      components: dashboardConfig.components.map((component) =>
        component.id === componentId ? updater(component) : component,
      ),
    });
  }

  function handleDeleteComponent(componentId: string) {
    saveDashboard({
      ...dashboardConfig,
      components: dashboardConfig.components.filter((component) => component.id !== componentId),
    });
  }

  function handleChangeChartType(componentId: string) {
    handleUpdateComponent(componentId, (component) => {
      if (component.type === 'bar_chart') {
        return {
          id: `${component.yAxis}_share_by_${component.xAxis}`,
          type: 'pie_chart',
          title: component.title.replace(' by ', ' Share by '),
          dataSource: component.dataSource,
          nameKey: component.xAxis,
          valueKey: component.yAxis,
        };
      }

      if (component.type === 'pie_chart') {
        return {
          id: `${component.valueKey}_by_${component.nameKey}`,
          type: 'bar_chart',
          title: component.title.replace(' Share by ', ' by '),
          dataSource: component.dataSource,
          xAxis: component.nameKey,
          yAxis: component.valueKey,
          color: '#1f7a8c',
        };
      }

      if (component.type === 'line_chart') {
        const firstSeries = component.series[0];
        return {
          id: `${firstSeries.metric}_by_channel`,
          type: 'bar_chart',
          title: `${firstSeries.label} by Channel`,
          dataSource: 'channel',
          xAxis: 'channel',
          yAxis: firstSeries.metric,
          color: firstSeries.color,
        };
      }

      return component;
    });
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div
        className={
          isSidebarCollapsed
            ? 'grid min-h-screen grid-cols-1 lg:grid-cols-[76px_minmax(0,1fr)] xl:grid-cols-[76px_minmax(0,1fr)_380px]'
            : 'grid min-h-screen grid-cols-1 lg:grid-cols-[268px_minmax(0,1fr)] xl:grid-cols-[268px_minmax(0,1fr)_380px]'
        }
      >
        <AppSidebar
          activeDashboardId={activeDashboardId}
          activeTheme={activeTheme}
          currentDashboardTitle={dashboardConfig.title}
          dashboards={dashboards.map((dashboard) => ({
            id: dashboard.id,
            name: dashboard.name,
            status: dashboard.status,
          }))}
          isCollapsed={isSidebarCollapsed}
          onAddDashboard={handleAddDashboard}
          onSelectDashboard={setActiveDashboardId}
          onThemeChange={setActiveTheme}
          onToggle={() => setIsSidebarCollapsed((current) => !current)}
        />
        <DashboardCanvas
          dashboardConfig={dashboardConfig}
          rows={dataRows}
          sourceLabel={sourceLabel}
          onChangeChartType={handleChangeChartType}
          onDeleteComponent={handleDeleteComponent}
          onUpdateComponent={handleUpdateComponent}
        />
        <AIAssistant
          currentDashboard={dashboardConfig}
          onDataImported={(dataset) => {
            const generatedDashboard = createDashboardFromImportedDataset(dataset);
            setDataRows(dataset.rows);
            setSourceLabel(`${dataset.sourceType.toUpperCase()}: ${dataset.fileName}`);
            saveDashboard(generatedDashboard);
          }}
          onDashboardGenerated={(nextDashboard) => saveDashboard(nextDashboard)}
          onResetDashboard={() => saveDashboard(validateDashboardConfig(defaultDashboardConfig))}
        />
      </div>
    </main>
  );
}
