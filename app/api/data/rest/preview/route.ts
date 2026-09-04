import { NextResponse } from 'next/server';
import { previewApiSource, type ApiSourceInput } from '@/lib/data/apiSource';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as ApiSourceInput;
    const dataset = await previewApiSource(input);

    return NextResponse.json({ dataset });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not preview API source.' },
      { status: 400 },
    );
  }
}
