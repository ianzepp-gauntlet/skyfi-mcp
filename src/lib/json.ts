export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export function parseJsonObject(
  text: string,
  context: string,
): Record<string, unknown> {
  const parsed = parseJson(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${context} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}
