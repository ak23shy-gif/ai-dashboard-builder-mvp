import { NextResponse } from 'next/server';
import { buildDashboardSystemPrompt, buildDashboardUserPrompt, dashboardJsonSchema } from '@/lib/ai/dashboardPrompt';
import { validateDashboardConfig } from '@/lib/ai/dashboardSchema';
import { generateLocalDashboard } from '@/lib/ai/demoDashboardGenerator';
import type { DashboardConfig } from '@/types/dashboard';

export const runtime = 'nodejs';
export const maxDuration = 10;

const providerTimeoutMs = 6500;

type DashboardApiRequest = {
  prompt?: string;
  currentDashboard?: DashboardConfig;
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

function localPlannerResponse(prompt: string, currentDashboard: DashboardConfig | undefined, reason: string) {
  return NextResponse.json({
    dashboard: generateLocalDashboard(prompt, currentDashboard),
    source: 'local',
    warning: reason,
  });
}

async function generateWithOpenAI(prompt: string, currentDashboard?: DashboardConfig) {
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
          content: buildDashboardUserPrompt(prompt, currentDashboard),
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

  const parsed = JSON.parse(outputText) as { dashboard?: DashboardConfig };

  if (!parsed.dashboard) {
    return localPlannerResponse(prompt, currentDashboard, 'Local planner used because the OpenAI response did not include a dashboard.');
  }

  return NextResponse.json({
    dashboard: validateDashboardConfig(parsed.dashboard),
    source: 'openai',
  });
}

async function generateWithGemini(prompt: string, currentDashboard?: DashboardConfig) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
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
                )}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
    },
  ).finally(() => clearTimeout(timeout));

  const result = await readProviderJson<GeminiResponse>(geminiResponse);

  if (!geminiResponse.ok) {
    return localPlannerResponse(
      prompt,
      currentDashboard,
      `Local planner used because Gemini returned: ${result.error?.message || 'request failed'}`,
    );
  }

  const outputText = extractGeminiOutputText(result);

  if (!outputText) {
    return localPlannerResponse(prompt, currentDashboard, 'Local planner used because Gemini returned an empty response.');
  }

  const parsed = JSON.parse(outputText) as { dashboard?: DashboardConfig };

  if (!parsed.dashboard) {
    return localPlannerResponse(prompt, currentDashboard, 'Local planner used because the Gemini response did not include a dashboard.');
  }

  return NextResponse.json({
    dashboard: validateDashboardConfig(parsed.dashboard),
    source: 'gemini',
  });
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

  try {
    const provider = preferredProvider();

    if (provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) {
        return localPlannerResponse(prompt, body.currentDashboard, 'Local planner used because GEMINI_API_KEY is missing.');
      }
      return await generateWithGemini(prompt, body.currentDashboard);
    }

    if (provider === 'openai') {
      if (!process.env.OPENAI_API_KEY) {
        return localPlannerResponse(prompt, body.currentDashboard, 'Local planner used because OPENAI_API_KEY is missing.');
      }
      return await generateWithOpenAI(prompt, body.currentDashboard);
    }

    return localPlannerResponse(prompt, body.currentDashboard, 'Local planner used because no cloud AI provider key is configured.');
  } catch (error) {
    return localPlannerResponse(
      prompt,
      body.currentDashboard,
      `Local planner used because generation failed: ${
        error instanceof Error ? error.message : 'unexpected dashboard generation error'
      }`,
    );
  }
}
