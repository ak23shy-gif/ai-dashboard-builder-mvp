import { NextResponse } from 'next/server';
import {
  previewDatabaseTable,
  type DatabaseConnectionInput,
  type DatabaseTable,
} from '@/lib/data/database';

export const runtime = 'nodejs';

type PreviewRequest = {
  connection: DatabaseConnectionInput;
  table: DatabaseTable;
};

export async function POST(request: Request) {
  try {
    const { connection, table } = (await request.json()) as PreviewRequest;
    const dataset = await previewDatabaseTable(connection, table);

    return NextResponse.json({ dataset });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not preview database table.' },
      { status: 400 },
    );
  }
}
