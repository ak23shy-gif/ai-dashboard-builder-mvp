import { NextResponse } from 'next/server';
import { buildDashboardSystemPrompt, buildDashboardUserPrompt, dashboardJsonSchema } from '@/lib/ai/dashboardPrompt';
import { validateDashboardConfig } from '@/lib/ai/dashboardSchema';
import { generateLocalDashboard } from '@/lib/ai/demoDashboardGenerator';
import type { DashboardDataContext } from '@/lib/data/importData';
import type { DashboardConfig } from '@/types/dashboard';

export const runtime = 'nodejs';
export const maxDuration = 30;

const providerTimeoutMs = 22000;

type DashboardApiRequest = {
  prompt?: string;
  currentDashboard?: DashboardConfig;
  dataContext?: DashboardDataContext;
};

type OpenAIContentItem = {
  type?: string;
  text?: string;
};

type OpenAIOutputItem = {
  content?: OpenAIContentItem[];
};

type OpenAIResponse = {
  output_text?: string;
  output?: OpenAIOutputItem[];
  error?: {
    message?: string;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

function uniqueValues<T>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function timeoutSignal() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);

  return { signal: controller.signal, timeout };
}

async function readProviderJson<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: {
        message: text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 240),
      },
    } as T;
  }
}

function extractOutputText(response: OpenAIResponse) {
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  return response.output
    ?.flatMap((item) => item.content || [])
    .map((content) => content.text)
    .filter(Boolean)
    .join('\n');
}

function extractGeminiOutputText(response: GeminiResponse) {
  return response.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join('\n');
}

function parseDashboardPayload(outputText: string) {
  try {
    return JSON.parse(outputText) as { dashboard?: DashboardConfig };
  } catch (error) {
    const start = outputText.indexOf('{');
    const end = outputText.lastIndexOf('}');

    if (start >= 0 && end > start) {
      return JSON.parse(outputText.slice(start, end + 1)) as { dashboard?: DashboardConfig };
    }

    throw error;
  }
}

function localPlannerResponse(prompt: string, currentDashboard: DashboardConfig | undefined, reason: string) {
  return NextResponse.json({
    dashboard: generateLocalDashboard(prompt, currentDashboard),
    source: 'local',
    warning: reason,
  });
}

async function generateWithOpenAI(prompt: string, currentDashboard?: DashboardConfig, dataContext?: DashboardDataContext) {
  const { signal, timeout } = timeoutSignal();
  const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      input: [
        {
          role: 'system',
          content: buildDashboardSystemPrompt(),
        },
        {
          role: 'user',
          content: buildDashboardUserPrompt(prompt, currentDashboard, dataContext),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'dashboard_response',
          schema: dashboardJsonSchema,
          strict: false,
        },
      },
      max_output_tokens: 3000,
    }),
  }).finally(() => clearTimeout(timeout));

  const result = await readProviderJson<OpenAIResponse>(openaiResponse);

  if (!openaiResponse.ok) {
    return localPlannerResponse(
      prompt,
      currentDashboard,
      `Local planner used because OpenAI returned: ${result.error?.message || 'request failed'}`,
    );
  }

  const outputText = extractOutputText(result);

  if (!outputText) {
    return localPlannerResponse(prompt, currentDashboard, 'Local planner used because OpenAI returned an empty response.');
  }

  const parsed = parseDashboardPayload(outputText);

  if (!parsed.dashboard) {
    return localPlannerResponse(prompt, currentDashboard, 'Local planner used because the OpenAI response did not include a dashboard.');
  }

  return NextResponse.json({
    dashboard: validateDashboardConfig(parsed.dashboard),
    source: 'openai',
  });
}

async function generateWithGemini(prompt: string, currentDashboard?: DashboardConfig, dataContext?: DashboardDataContext) {
  const models = uniqueValues([
    process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
  ]);
  const failures: string[] = [];

  for (const model of models) {
    const { signal, timeout } = timeoutSignal();
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${buildDashboardSystemPrompt()}\n\nReturn a single JSON object with this shape: {"dashboard": {...}}.\n\n${buildDashboardUserPrompt(
                    prompt,
                    currentDashboard,
                    dataContext,
                  )}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 4096,
          },
        }),
      },
    ).finally(() => clearTimeout(timeout));

    const result = await readProviderJson<GeminiResponse>(geminiResponse);

    if (!geminiResponse.ok) {
      failures.push(`${model}: ${result.error?.message || 'request failed'}`);
      continue;
    }

    const outputText = extractGeminiOutputText(result);

    if (!outputText) {
      failures.push(`${model}: empty response`);
      continue;
    }

    let parsed: { dashboard?: DashboardConfig };

    try {
      parsed = parseDashboardPayload(outputText);
    } catch (error) {
      failures.push(`${model}: invalid JSON (${error instanceof Error ? error.message : 'parse failed'})`);
      continue;
    }

    if (!parsed.dashboard) {
      failures.push(`${model}: response did not include a dashboard`);
      continue;
    }

    return NextResponse.json({
      dashboard: validateDashboardConfig(parsed.dashboard),
      source: 'gemini',
      model,
    });
  }

  return localPlannerResponse(
    prompt,
    currentDashboard,
    `Local planner used because Gemini did not return a usable dashboard. Tried ${models.join(', ')}. Last issue: ${
      failures.at(-1) || 'request failed'
    }`,
  );
}

function preferredProvider() {
  if (process.env.AI_PROVIDER === 'gemini') {
    return 'gemini';
  }

  if (process.env.AI_PROVIDER === 'openai') {
    return 'openai';
  }

  if (process.env.GEMINI_API_KEY) {
    return 'gemini';
  }

  if (process.env.OPENAI_API_KEY) {
    return 'openai';
  }

  return 'local';
}

export async function POST(request: Request) {
  let body: DashboardApiRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const prompt = body.prompt?.trim();

  if (!prompt) {
    return NextResponse.json({ error: 'Please enter a dashboard prompt.' }, { status: 400 });
  }

  const provider = preferredProvider();

  try {
    if (provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) {
        return localPlannerResponse(prompt, body.currentDashboard, 'Local planner used because GEMINI_API_KEY is missing.');
      }
      return await generateWithGemini(prompt, body.currentDashboard, body.dataContext);
    }

    if (provider === 'openai') {
      if (!process.env.OPENAI_API_KEY) {
        return localPlannerResponse(prompt, body.currentDashboard, 'Local planner used because OPENAI_API_KEY is missing.');
      }
      return await generateWithOpenAI(prompt, body.currentDashboard, body.dataContext);
    }

    return localPlannerResponse(prompt, body.currentDashboard, 'Local planner used because no cloud AI provider key is configured.');
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';

    return localPlannerResponse(
      prompt,
      body.currentDashboard,
      aborted
        ? `Local planner used because ${provider} did not respond within ${Math.round(providerTimeoutMs / 1000)} seconds.`
        : `Local planner used because generation failed: ${
            error instanceof Error ? error.message : 'unexpected dashboard generation error'
          }`,
    );
  }
}
