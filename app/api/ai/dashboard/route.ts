import { NextResponse } from 'next/server';
import { buildDashboardSystemPrompt, buildDashboardUserPrompt, dashboardJsonSchema } from '@/lib/ai/dashboardPrompt';
import { blankDashboardConfig, validateDashboardConfig } from '@/lib/ai/dashboardSchema';
import { createDashboardFromDataContext } from '@/lib/ai/dataContextDashboard';
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

function timeoutSignal() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);

  return { signal: controller.signal, timeout };
}

function geminiThinkingConfig(model: string) {
  if (model.startsWith('gemini-2.5')) {
    return { thinkingBudget: 0 };
  }

  if (model.startsWith('gemini-3')) {
    return { thinkingLevel: 'low' };
  }

  return undefined;
}

function providerIssue(provider: string, status: number, message: string | undefined) {
  const detail = message ? ` ${message.slice(0, 180)}` : '';

  if (status === 400) {
    return `${provider} rejected the request format.${detail}`;
  }

  if (status === 401 || status === 403) {
    return `${provider} rejected the API key or project access.${detail}`;
  }

  if (status === 404) {
    return `${provider} could not find the configured model.${detail}`;
  }

  if (status === 429) {
    return `${provider} quota or rate limit was reached.${detail}`;
  }

  if (status >= 500) {
    return `${provider} service returned ${status}.${detail}`;
  }

  return `${provider} returned ${status}.${detail}`;
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

function finalDashboard(
  generatedDashboard: DashboardConfig,
  prompt: string,
  currentDashboard: DashboardConfig | undefined,
  dataContext: DashboardDataContext | undefined,
) {
  if (!dataContext) {
    return validateDashboardConfig(generatedDashboard);
  }

  const generated = validateDashboardConfig(generatedDashboard);
  const dataAwareDashboard = createDashboardFromDataContext(prompt, currentDashboard, dataContext);

  return validateDashboardConfig({
    ...dataAwareDashboard,
    id: generated.id || dataAwareDashboard.id,
    title: dataAwareDashboard.title,
    description: dataAwareDashboard.description,
    components: dataAwareDashboard.components,
  });
}

function localPlannerResponse(
  prompt: string,
  currentDashboard: DashboardConfig | undefined,
  reason: string,
  dataContext?: DashboardDataContext,
) {
  return NextResponse.json({
    dashboard: dataContext
      ? createDashboardFromDataContext(prompt, currentDashboard, dataContext)
      : generateLocalDashboard(prompt, currentDashboard),
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
      dataContext,
    );
  }

  const outputText = extractOutputText(result);

  if (!outputText) {
    return localPlannerResponse(prompt, currentDashboard, 'Local planner used because OpenAI returned an empty response.', dataContext);
  }

  const parsed = parseDashboardPayload(outputText);

  if (!parsed.dashboard) {
    return localPlannerResponse(
      prompt,
      currentDashboard,
      'Local planner used because the OpenAI response did not include a dashboard.',
      dataContext,
    );
  }

  return NextResponse.json({
    dashboard: finalDashboard(parsed.dashboard, prompt, currentDashboard, dataContext),
    source: 'openai',
  });
}

async function generateWithGemini(prompt: string, currentDashboard?: DashboardConfig, dataContext?: DashboardDataContext) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const { signal, timeout } = timeoutSignal();
  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': String(process.env.GEMINI_API_KEY),
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: buildDashboardSystemPrompt(),
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Return only valid JSON with this exact outer shape: {"dashboard": {...}}. Do not use markdown fences or explanatory text.\n\n${buildDashboardUserPrompt(
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
          maxOutputTokens: 4096,
          thinkingConfig: geminiThinkingConfig(model),
        },
      }),
    },
  ).finally(() => clearTimeout(timeout));

  const result = await readProviderJson<GeminiResponse>(geminiResponse);

  if (!geminiResponse.ok) {
    return localPlannerResponse(
      prompt,
      currentDashboard,
      `${providerIssue('Gemini', geminiResponse.status, result.error?.message)} DashForge used the local analyst planner.`,
      dataContext,
    );
  }

  const outputText = extractGeminiOutputText(result);

  if (!outputText) {
    return localPlannerResponse(
      prompt,
      currentDashboard,
      `Gemini returned an empty response for ${model}, so DashForge used the local analyst planner.`,
      dataContext,
    );
  }

  try {
    const parsed = parseDashboardPayload(outputText);

    if (!parsed.dashboard) {
      return localPlannerResponse(
        prompt,
        currentDashboard,
        `Gemini responded without dashboard JSON for ${model}, so DashForge used the local analyst planner.`,
        dataContext,
      );
    }

    return NextResponse.json({
      dashboard: finalDashboard(parsed.dashboard, prompt, currentDashboard, dataContext),
      source: 'gemini',
      model,
    });
  } catch {
    return localPlannerResponse(
      prompt,
      currentDashboard,
      `Gemini returned JSON that did not match the dashboard schema for ${model}, so DashForge used the local analyst planner.`,
      dataContext,
    );
  }
}

function preferredProvider() {
  const configuredProvider = process.env.AI_PROVIDER?.trim().toLowerCase();

  if (configuredProvider === 'openai') {
    return 'openai';
  }

  if (configuredProvider === 'gemini') {
    return 'gemini';
  }

  if (process.env.OPENAI_API_KEY) {
    return 'openai';
  }

  if (process.env.GEMINI_API_KEY) {
    return 'gemini';
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

  if (!body.dataContext) {
    return NextResponse.json({
      dashboard: validateDashboardConfig(blankDashboardConfig),
      source: 'local',
      warning: 'No data source is connected. Connect CSV, Excel, database or API data before generating a dashboard.',
    });
  }

  const provider = preferredProvider();

  try {
    if (provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) {
        return localPlannerResponse(prompt, body.currentDashboard, 'Local planner used because GEMINI_API_KEY is missing.', body.dataContext);
      }
      return await generateWithGemini(prompt, body.currentDashboard, body.dataContext);
    }

    if (provider === 'openai') {
      if (!process.env.OPENAI_API_KEY) {
        return localPlannerResponse(prompt, body.currentDashboard, 'Local planner used because OPENAI_API_KEY is missing.', body.dataContext);
      }
      return await generateWithOpenAI(prompt, body.currentDashboard, body.dataContext);
    }

    return localPlannerResponse(
      prompt,
      body.currentDashboard,
      'Local planner used because no cloud AI provider key is configured.',
      body.dataContext,
    );
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
      body.dataContext,
    );
  }
}
