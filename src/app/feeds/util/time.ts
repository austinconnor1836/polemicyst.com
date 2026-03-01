export function formatRelativeTime(iso?: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(seconds);

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (absSeconds < 60) return rtf.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  return rtf.format(days, 'day');
}
