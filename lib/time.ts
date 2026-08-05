export const DEFAULT_TIMEZONE = "UTC";

function partsFor(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function resolveTimezone(candidate?: string | null) {
  const value = candidate?.trim();
  if (!value) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function localDateKey(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = partsFor(date, resolveTimezone(timeZone));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function localTimestamp(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const tz = resolveTimezone(timeZone);
  const parts = partsFor(date, tz);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${tz}`;
}

export function localDateTimeForPrompt(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const tz = resolveTimezone(timeZone);
  const parts = partsFor(date, tz);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} (${tz})`;
}
