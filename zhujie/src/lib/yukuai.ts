import { getYuKuai, upsertYuKuai, recordEncounter, upsertUserYuKuai } from './db';
import { enrichYuKuai as cedictEnrich } from './cedict';
import type { YuKuai, LLMYuKuaiItem } from './yukuai-types';

/**
 * Process a YuKuai from LLM output:
 * 1. Check if it already exists in DB
 * 2. If not, create it with CC-CEDICT enrichment
 * 3. Return the full YuKuai entity
 */
export async function ensureYuKuai(item: LLMYuKuaiItem): Promise<YuKuai> {
  const existing = await getYuKuai(item.canonical_id);
  if (existing) return existing;

  const cedict = cedictEnrich(item.canonical_id.split(':')[1] ?? item.surface_form, item.type);

  const yk: YuKuai = {
    id: item.canonical_id,
    type: item.type,
    canonical_form: item.canonical_id.split(':')[1] ?? item.surface_form,
    pinyin: cedict.pinyin,
    hsk_level: cedict.hsk_level,
    base_definition: cedict.base_definition,
  };

  await upsertYuKuai(yk);
  return yk;
}

/**
 * Process a full line decomposition for a user:
 * 1. Ensure all YuKuai entities exist
 * 2. Record encounters for logged-in users
 * 3. Update user familiarity state
 */
export async function processDecomposition(
  userId: string | null,
  contentHash: string,
  lineIndex: number,
  items: LLMYuKuaiItem[],
): Promise<YuKuai[]> {
  const yukuaiEntities: YuKuai[] = [];

  for (const item of items) {
    const yk = await ensureYuKuai(item);
    yukuaiEntities.push(yk);

    if (userId) {
      await recordEncounter({
        user_id: userId,
        yukuai_id: yk.id,
        content_hash: contentHash,
        line_index: lineIndex,
        surface_form: item.surface_form,
        contextual_meaning: item.contextual_meaning,
      });

      // Update familiarity — new encounters stay 'new', will transition via familiarity engine
      await upsertUserYuKuai(userId, yk.id, 'new', contentHash);
    }
  }

  return yukuaiEntities;
}
