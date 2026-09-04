'use client';

import { useState } from 'react';
import { Braces, Loader2, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ApiSourceInput } from '@/lib/data/apiSource';
import type { ImportedDataset } from '@/lib/data/importData';

type ApiSourceConnectorProps = {
  onDataImported: (dataset: ImportedDataset) => void;
};

export function ApiSourceConnector({ onDataImported }: ApiSourceConnectorProps) {
  const [apiSource, setApiSource] = useState<ApiSourceInput>({
    url: '',
    method: 'GET',
    headers: '',
    body: '',
    dataPath: '',
  });
  const [state, setState] = useState({
    status: 'idle' as 'idle' | 'success' | 'error',
    message: 'Connect any JSON API endpoint and generate a dashboard from the returned rows.',
  });
  const [isLoading, setIsLoading] = useState(false);

  function updateSource<K extends keyof ApiSourceInput>(key: K, value: ApiSourceInput[K]) {
    setApiSource((current) => ({ ...current, [key]: value }));
  }

  async function handlePreviewApi() {
    if (!apiSource.url.trim()) {
      setState({ status: 'error', message: 'Please enter an API URL first.' });
      return;
    }

    setIsLoading(true);
    setState({ status: 'idle', message: 'Calling API and reading JSON rows...' });

    try {
      const response = await fetch('/api/data/rest/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiSource),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'API preview failed.');
      }

      onDataImported(result.dataset as ImportedDataset);
      setState({
        status: 'success',
        message: `Dashboard generated from API. Using ${(result.dataset as ImportedDataset).processedRowCount.toLocaleString('en-GB')} usable rows.`,
      });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not connect to the API.',
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-950">API connection</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Server-side REST/JSON connector for business APIs, CRM APIs and analytics APIs.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-[110px_1fr]">
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Method
          <select
            className="h-9 rounded-md border border-border bg-card px-3 text-sm text-slate-900 outline-none transition focus-visible:ring-2 focus-visible:ring-primary"
            value={apiSource.method}
            onChange={(event) => updateSource('method', event.target.value as 'GET' | 'POST')}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          API URL
          <Input
            value={apiSource.url}
            onChange={(event) => updateSource('url', event.target.value)}
            placeholder="https://api.example.com/reports"
          />
        </label>
      </div>

      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        Data path
        <Input
          value={apiSource.dataPath || ''}
          onChange={(event) => updateSource('dataPath', event.target.value)}
          placeholder="Optional, for example data.items"
        />
      </label>

      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        Headers JSON
        <Textarea
          className="min-h-20 resize-y font-mono text-xs"
          value={apiSource.headers || ''}
          onChange={(event) => updateSource('headers', event.target.value)}
          placeholder={'{"Authorization":"Bearer YOUR_TOKEN"}'}
        />
      </label>

      {apiSource.method === 'POST' && (
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Body JSON
          <Textarea
            className="min-h-20 resize-y font-mono text-xs"
            value={apiSource.body || ''}
            onChange={(event) => updateSource('body', event.target.value)}
            placeholder={'{"from":"2026-01-01","to":"2026-12-31"}'}
          />
        </label>
      )}

      <Button disabled={isLoading} onClick={handlePreviewApi} className="w-full">
        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
        Generate from API
      </Button>

      <div
        className={
          state.status === 'error'
            ? 'rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700'
            : state.status === 'success'
              ? 'rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-700'
              : 'rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-500'
        }
      >
        <span className="inline-flex items-start gap-2">
          <Braces className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {state.message}
        </span>
      </div>
    </div>
  );
}
