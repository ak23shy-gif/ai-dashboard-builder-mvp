import { NextResponse } from 'next/server';
import { listDatabaseTables, type DatabaseConnectionInput } from '@/lib/data/database';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const connection = (await request.json()) as DatabaseConnectionInput;
    const tables = await listDatabaseTables(connection);

    return NextResponse.json({ tables });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load database tables.' },
      { status: 400 },
    );
  }
}
