import { NextResponse } from 'next/server';
import { testDatabaseConnection, type DatabaseConnectionInput } from '@/lib/data/database';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const connection = (await request.json()) as DatabaseConnectionInput;
    await testDatabaseConnection(connection);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Database connection failed.' },
      { status: 400 },
    );
  }
}
