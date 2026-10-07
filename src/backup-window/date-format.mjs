export function formatBackupDate(value, currentDate) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    ...(date.getFullYear() === currentDate.getFullYear() ? {} : { year: "numeric" }),
  });
}
