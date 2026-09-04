'use client';

import { useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CornerDownLeft,
  Loader2,
  MessageSquareText,
  RotateCcw,
  ShieldCheck,
  Wand2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { DataSourcePanel } from '@/components/data/DataSourcePanel';
import type { ImportedDataset } from '@/lib/data/importData';
import type { DashboardConfig } from '@/types/dashboard';

const examples = [
  'Create an executive overview using the most important measures and dimensions.',
  'Add a filter for the main category field.',
  'Change the primary trend chart to a bar chart.',
  'Add a KPI for completed outcomes.',
  'Remove the activity volume chart.',
  'Change the composition chart from channel to brand.',
  'Make this dashboard focus on activity volume over time.',
];

type AIAssistantProps = {
  currentDashboard: DashboardConfig;
  onDataImported: (dataset: ImportedDataset) => void;
  onDashboardGenerated: (dashboard: DashboardConfig) => void;
  onResetDashboard: () => void;
};

export function AIAssistant({
  currentDashboard,
  onDataImported,
  onDashboardGenerated,
  onResetDashboard,
}: AIAssistantProps) {
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('AI generation is ready. Upload data or describe the dashboard you want.');

  async function handleGenerate() {
    if (!prompt.trim()) {
      setStatus('error');
      setMessage('Please enter a dashboard prompt first.');
      return;
    }

    setStatus('loading');
    setMessage('Analysing the prompt and current dashboard configuration...');

    try {
      const response = await fetch('/api/ai/dashboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, currentDashboard }),
      });

      const result = (await response.json()) as {
        dashboard?: DashboardConfig;
        error?: string;
        setup?: string;
        source?: 'openai' | 'gemini' | 'local';
        warning?: string;
      };

      if (!response.ok) {
        throw new Error(result.setup || result.error || 'Dashboard generation failed.');
      }

      if (result.dashboard) {
        onDashboardGenerated(result.dashboard);
      }

      const sourceLabel =
        result.source === 'local' ? 'Local planner' : result.source === 'gemini' ? 'Gemini' : 'OpenAI';

      setStatus('success');
      setMessage(
        `${sourceLabel} generated and rendered: ${result.dashboard?.title || 'Untitled dashboard'} with ${
          result.dashboard?.components?.length || 0
        } components.${result.warning ? ` ${result.warning}` : ''}`,
      );
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Unexpected AI route error.');
    }
  }

  function handleReset() {
    onResetDashboard();
    setStatus('idle');
    setMessage('Dashboard reset to the default JSON configuration.');
  }

  return (
    <aside className="flex min-h-screen w-full flex-col overflow-auto border-l border-slate-200 bg-white px-4 py-4 xl:w-[390px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-white">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">AI Copilot</h2>
            <p className="text-xs text-muted-foreground">Prompt to dashboard JSON</p>
          </div>
        </div>
        <Badge>Live</Badge>
      </div>

      <Card className="mt-5 border-slate-200/80 shadow-none">
        <CardHeader>
          <div>
            <CardTitle>Describe a dashboard</CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Generate or refine the current analysis surface.</p>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            aria-label="Dashboard prompt"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Create an operations dashboard showing volume, completion, exceptions and monthly trends..."
            value={prompt}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Uses Gemini/OpenAI when configured, with a local planner fallback.</p>
            <Button disabled={status === 'loading'} onClick={handleGenerate}>
              {status === 'loading' ? 'Sending' : 'Generate'}
              {status === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CornerDownLeft className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button disabled={status === 'loading' || !prompt.trim()} onClick={handleGenerate} variant="outline">
              <Wand2 className="h-4 w-4" />
              Regenerate
            </Button>
            <Button disabled={status === 'loading'} onClick={handleReset} variant="outline">
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </div>
          <div
            className={
              status === 'error'
                ? 'mt-3 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700'
                : status === 'success'
                  ? 'mt-3 flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-700'
                  : 'mt-3 flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground'
            }
          >
            {status === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : status === 'error' ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{message}</span>
          </div>
        </CardContent>
      </Card>

      <DataSourcePanel onDataImported={onDataImported} />

      <div className="mt-5 grid gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          <MessageSquareText className="h-4 w-4" />
          Example instructions
        </div>
        {examples.map((example) => (
          <button
            className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-left text-sm leading-6 text-slate-700 transition hover:border-primary/40 hover:bg-white hover:shadow-sm"
            key={example}
            onClick={() => setPrompt(example)}
          >
            {example}
          </button>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Secure by design</p>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          The OpenAI key stays on the server through an API route. The LLM returns JSON only,
          never arbitrary HTML or React code.
        </p>
      </div>
    </aside>
  );
}
