import { NextRequest, NextResponse } from 'next/server';
import { getContent, getLineAnnotation, storeLineAnnotation, ensureTables } from '@/lib/db';
import { generateLineAnnotation } from '@/lib/annotate';
import type { AnnotateLineRequest } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    await ensureTables();

    const body = (await request.json()) as AnnotateLineRequest;
    if (!body.contentHash || body.lineIndex === undefined) {
      return NextResponse.json(
        { error: 'contentHash and lineIndex are required' },
        { status: 400 },
      );
    }

    const cached = await getLineAnnotation(body.contentHash, body.lineIndex);
    if (cached) {
      return NextResponse.json(cached);
    }

    const content = await getContent(body.contentHash);
    if (!content) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    const lines = content.source_text.split('\n');
    if (body.lineIndex < 0 || body.lineIndex >= lines.length) {
      return NextResponse.json({ error: 'Line index out of range' }, { status: 400 });
    }

    const annotation = await generateLineAnnotation(
      content.content_map,
      content.source_text,
      lines,
      body.lineIndex,
    );

    await storeLineAnnotation(body.contentHash, body.lineIndex, annotation);

    return NextResponse.json(annotation);
  } catch (error) {
    console.error('Annotate line error:', error);
    return NextResponse.json(
      { error: 'Failed to annotate line' },
      { status: 500 },
    );
  }
}
