import type { VfsEntry } from '@agent-assistant/vfs';

export function matchesFilters(entry: VfsEntry, filters: Record<string, string[]>): boolean {
  const properties = entry.properties ?? {};

  return Object.entries(filters).every(([key, values]) => {
    if (values.length === 0) {
      return true;
    }

    const propertyValue = properties[key];
    return propertyValue !== undefined && values.includes(propertyValue);
  });
}
