/**
 * Build a DynamoDB UpdateExpression from a flat patch object.
 * - `null` / `undefined` values become REMOVE clauses.
 * - Returns `null` for an empty or no-op patch (caller should skip the update).
 */
export interface BuiltUpdate {
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
}

export function buildUpdateExpression(patch: Record<string, unknown>): BuiltUpdate | null {
  const entries = Object.entries(patch);
  if (entries.length === 0) return null;

  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  const removes: string[] = [];

  for (const [i, [k, v]] of entries.entries()) {
    const nk = `#k${i}`;
    names[nk] = k;
    if (v === undefined || v === null) {
      removes.push(nk);
    } else {
      const vk = `:v${i}`;
      values[vk] = v;
      sets.push(`${nk} = ${vk}`);
    }
  }

  if (sets.length === 0 && removes.length === 0) return null;

  const parts: string[] = [];
  if (sets.length) parts.push(`SET ${sets.join(', ')}`);
  if (removes.length) parts.push(`REMOVE ${removes.join(', ')}`);

  return {
    UpdateExpression: parts.join(' '),
    ExpressionAttributeNames: names,
    ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
  };
}
