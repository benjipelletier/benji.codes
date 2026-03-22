import { NextRequest, NextResponse } from 'next/server';
import { normalizeText, splitLines, hashContent } from '@/lib/hash';
import { detectMetadata } from '@/lib/metadata';
import { getContent, storeContent, ensureTables } from '@/lib/db';
import { generateContentMap } from '@/lib/annotate';
import type { ContentMapRequest, ContentMapResponse } from '@/lib/types';

const MAX_TEXT_LENGTH = 20000;

export async function POST(request: NextRequest) {
  try {
    await ensureTables();

    const body = (await request.json()) as ContentMapRequest;
    if (!body.text || body.text.trim().length === 0) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }
    if (body.text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Text too long (max ${MAX_TEXT_LENGTH} characters)` },
        { status: 400 },
      );
    }

    const normalized = normalizeText(body.text);
    const contentHash = hashContent(normalized);
    const lines = splitLines(body.text);

    // Check cache
    const existing = await getContent(contentHash);
    if (existing) {
      const response: ContentMapResponse = {
        contentHash,
        contentMap: existing.content_map,
        lines,
        metadata: {
          title: existing.title,
          artist: existing.artist,
          contentType: existing.content_type as ContentMapResponse['metadata']['contentType'],
          languageVariant: existing.language_variant as 'simplified' | 'traditional',
        },
      };
      return NextResponse.json(response);
    }

    // Generate content map
    const metadata = detectMetadata(body.text, {
      title: body.title,
      artist: body.artist,
      contentType: body.contentType,
    });
    const contentMap = await generateContentMap(normalized);

    if (contentMap.language_variant) {
      metadata.languageVariant = contentMap.language_variant;
    }

    await storeContent(contentHash, normalized, contentMap, metadata);

    const response: ContentMapResponse = {
      contentHash,
      contentMap,
      lines,
      metadata,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Content map error:', error);
    return NextResponse.json(
      { error: 'Failed to generate content map' },
      { status: 500 },
    );
  }
}
