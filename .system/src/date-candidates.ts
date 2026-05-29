export function inferDateCandidates(value: string) {
  const candidates = new Set<string>();
  for (const match of value.matchAll(/\b(20\d{2})[-_/]?([01]\d)[-_/]?([0-3]\d)\b/g)) {
    const candidate = toIsoDate(match[1], match[2], match[3]);
    if (candidate) candidates.add(candidate);
  }
  for (const match of value.matchAll(/\b([01]\d)[-_/]([0-3]\d)[-_/](20\d{2})\b/g)) {
    const candidate = toIsoDate(match[3], match[1], match[2]);
    if (candidate) candidates.add(candidate);
  }
  return [...candidates].sort();
}

export function firstDateCandidate(value: string) {
  return inferDateCandidates(value)[0];
}

function toIsoDate(yearValue: string, monthValue: string, dayValue: string) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${yearValue}-${monthValue}-${dayValue}`;
}
