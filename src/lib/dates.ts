const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function dayDifference(later: Date, earlier: Date): number {
  const laterDay = Date.UTC(
    later.getFullYear(),
    later.getMonth(),
    later.getDate(),
  );
  const earlierDay = Date.UTC(
    earlier.getFullYear(),
    earlier.getMonth(),
    earlier.getDate(),
  );
  return Math.round((laterDay - earlierDay) / DAY_MS);
}

export function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

export function nextMorning(value: Date, days = 1, hour = 9): Date {
  const result = addDays(startOfDay(value), days);
  result.setHours(hour, 0, 0, 0);
  return result;
}

export function isDue(dueAt: Date | undefined, now = new Date()): boolean {
  return Boolean(dueAt && dueAt.getTime() <= now.getTime());
}

export function localDateKey(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
