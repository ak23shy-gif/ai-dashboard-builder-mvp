'use client';

import { ChangeEvent, useState } from 'react';
import { CheckCircle2, Database, FileSpreadsheet, Loader2, PlugZap, Table2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiSourceConnector } from '@/components/data/ApiSourceConnector';
import { importDashboardFile, type ImportedDataset } from '@/lib/data/importData';
import type { DatabaseConnectionInput, DatabaseProvider, DatabaseTable } from '@/lib/data/database';

type ImportState = {
  status: 'idle' | 'success' | 'error';
  message: string;
  columns: string[];
};

type DataSourcePanelProps = {
  onDataImported: (dataset: ImportedDataset) => void;
};

export function DataSourcePanel({ onDataImported }: DataSourcePanelProps) {
  const [importState, setImportState] = useState<ImportState>({
    status: 'idle',
    message: 'Upload CSV or Excel to replace the sample dataset.',
    columns: [],
  });
  const [isImporting, setIsImporting] = useState(false);
  const [connection, setConnection] = useState<DatabaseConnectionInput>({
    provider: 'postgres',
    host: '',
    port: 5432,
    database: '',
    username: '',
    password: '',
    ssl: false,
  });
  const [tables, setTables] = useState<DatabaseTable[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [databaseState, setDatabaseState] = useState({
    status: 'idle' as 'idle' | 'success' | 'error',
    message: 'Connect a database to preview a table and generate a dashboard.',
  });
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  function updateConnection<K extends keyof DatabaseConnectionInput>(key: K, value: DatabaseConnectionInput[K]) {
    setConnection((current) => {
      const next = { ...current, [key]: value };

      if (key === 'provider') {
        const provider = value as DatabaseProvider;
        next.port = provider === 'postgres' ? 5432 : provider === 'mysql' ? 3306 : 1433;
      }

      return next;
    });
    setTables([]);
    setSelectedTable('');
  }

  async function callDatabaseApi<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Database request failed.');
    }

    return result as T;
  }

  async function handleTestConnection() {
    setIsTestingConnection(true);
    setDatabaseState({ status: 'idle', message: 'Testing database connection...' });

    try {
      await callDatabaseApi<{ ok: boolean }>('/api/data/database/test', connection);
      setDatabaseState({ status: 'success', message: 'Connection successful. Now load tables.' });
    } catch (error) {
      setDatabaseState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Connection failed.',
      });
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function handleLoadTables() {
    setIsLoadingTables(true);
    setDatabaseState({ status: 'idle', message: 'Loading database tables...' });

    try {
      const result = await callDatabaseApi<{ tables: DatabaseTable[] }>('/api/data/database/tables', connection);
      setTables(result.tables);
      setSelectedTable(result.tables[0] ? `${result.tables[0].schema}.${result.tables[0].name}` : '');
      setDatabaseState({
        status: 'success',
        message: result.tables.length ? `Found ${result.tables.length} tables. Select one to preview.` : 'Connected, but no base tables were found.',
      });
    } catch (error) {
      setDatabaseState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not load tables.',
      });
    } finally {
      setIsLoadingTables(false);
    }
  }

  async function handlePreviewTable() {
    const table = tables.find((item) => `${item.schema}.${item.name}` === selectedTable);
    if (!table) {
      setDatabaseState({ status: 'error', message: 'Please select a table first.' });
      return;
    }

    setIsLoadingPreview(true);
    setDatabaseState({ status: 'idle', message: `Previewing ${selectedTable}...` });

    try {
      const result = await callDatabaseApi<{ dataset: ImportedDataset }>('/api/data/database/preview', {
        connection,
        table,
      });
      onDataImported(result.dataset);
      setDatabaseState({
        status: 'success',
        message: `Dashboard generated from ${selectedTable}. Previewed ${result.dataset.processedRowCount.toLocaleString('en-GB')} usable rows.`,
      });
    } catch (error) {
      setDatabaseState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not preview table.',
      });
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsImporting(true);
    setImportState({
      status: 'idle',
      message: `Reading ${file.name}...`,
      columns: [],
    });

    try {
      const imported = await importDashboardFile(file);
      onDataImported(imported);
      setImportState({
        status: 'success',
        message: `${imported.sourceType.toUpperCase()} connected: ${imported.fileName}. Using ${imported.processedRowCount.toLocaleString('en-GB')} rows${imported.isLimited ? ' for responsive dashboard performance' : ''} across ${imported.columns.length} detected fields.`,
        columns: imported.columns,
      });
    } catch (error) {
      setImportState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not import the selected file.',
        columns: [],
      });
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  }

  return (
    <Card className="mt-5 border-slate-200/80 shadow-none">
      <CardHeader>
        <div>
          <CardTitle>Data source</CardTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Upload CSV or Excel and the dashboard will recalculate from that file.</p>
        </div>
        <Badge>Live</Badge>
      </CardHeader>
      <CardContent>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-sm transition hover:border-primary/50 hover:bg-white">
          <span className="flex min-w-0 items-center gap-2">
            {isImporting ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            ) : (
              <Upload className="h-4 w-4 shrink-0 text-primary" />
            )}
            <span className="truncate">Upload CSV or Excel</span>
          </span>
          <input accept=".csv,.xlsx,.xls" className="sr-only" disabled={isImporting} onChange={handleFileChange} type="file" />
        </label>

        <div
          className={
            importState.status === 'error'
              ? 'mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700'
              : importState.status === 'success'
                ? 'mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-700'
                : 'mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-500'
          }
        >
          {importState.message}
        </div>

        {importState.columns.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {importState.columns.slice(0, 8).map((column) => (
              <Badge key={column}>{column}</Badge>
            ))}
          </div>
        )}

        <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            CSV and Excel files update the dashboard
          </div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
            Common columns are detected automatically
          </div>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            PostgreSQL / MySQL / SQL Server update the dashboard through server connectors
          </div>
          <div className="flex items-center gap-2">
            <PlugZap className="h-4 w-4 text-primary" />
            REST / CRM / analytics APIs update the dashboard
          </div>
        </div>

        <Button className="mt-4 w-full" disabled={!importState.columns.length} variant="outline">
          Field mapping detected automatically
        </Button>

        <div className="my-5 border-t border-slate-200" />

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Database connection</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Server-side connector for PostgreSQL, MySQL and SQL Server.
            </p>
          </div>

          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            Database type
            <select
              className="h-9 rounded-md border border-border bg-card px-3 text-sm text-slate-900 outline-none transition focus-visible:ring-2 focus-visible:ring-primary"
              value={connection.provider}
              onChange={(event) => updateConnection('provider', event.target.value as DatabaseProvider)}
            >
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
              <option value="sqlserver">SQL Server</option>
            </select>
          </label>

          <div className="grid gap-2 md:grid-cols-[1fr_90px]">
            <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
              Host
              <Input value={connection.host} onChange={(event) => updateConnection('host', event.target.value)} placeholder="localhost or server name" />
            </label>
            <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
              Port
              <Input
                type="number"
                value={connection.port || ''}
                onChange={(event) => updateConnection('port', Number(event.target.value))}
              />
            </label>
          </div>

          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            Database
            <Input value={connection.database} onChange={(event) => updateConnection('database', event.target.value)} placeholder="database name" />
          </label>

          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
              Username
              <Input value={connection.username} onChange={(event) => updateConnection('username', event.target.value)} placeholder="user" />
            </label>
            <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
              Password
              <Input
                type="password"
                value={connection.password}
                onChange={(event) => updateConnection('password', event.target.value)}
                placeholder="password"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <input
              checked={Boolean(connection.ssl)}
              onChange={(event) => updateConnection('ssl', event.target.checked)}
              type="checkbox"
            />
            Use SSL/encryption
          </label>

          <div className="grid gap-2 md:grid-cols-2">
            <Button disabled={isTestingConnection} onClick={handleTestConnection} variant="outline">
              {isTestingConnection ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
              Test
            </Button>
            <Button disabled={isLoadingTables} onClick={handleLoadTables} variant="outline">
              {isLoadingTables ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Table2 className="mr-2 h-4 w-4" />}
              Load tables
            </Button>
          </div>

          {tables.length > 0 && (
            <div className="grid gap-2">
              <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                Table
                <select
                  className="h-9 rounded-md border border-border bg-card px-3 text-sm text-slate-900 outline-none transition focus-visible:ring-2 focus-visible:ring-primary"
                  value={selectedTable}
                  onChange={(event) => setSelectedTable(event.target.value)}
                >
                  {tables.map((table) => (
                    <option key={`${table.schema}.${table.name}`} value={`${table.schema}.${table.name}`}>
                      {table.schema}.{table.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button disabled={isLoadingPreview || !selectedTable} onClick={handlePreviewTable}>
                {isLoadingPreview ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                Generate from table
              </Button>
            </div>
          )}

          <div
            className={
              databaseState.status === 'error'
                ? 'rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700'
                : databaseState.status === 'success'
                  ? 'rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-700'
                  : 'rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-500'
            }
          >
            {databaseState.message}
          </div>
        </div>

        <div className="my-5 border-t border-slate-200" />

        <ApiSourceConnector onDataImported={onDataImported} />
      </CardContent>
    </Card>
  );
}
