import type { Range } from "@/domain";

function timeLabel(timestamp: number, range: Range) {
  return new Intl.DateTimeFormat(
    "en-GB",
    range === "7d"
      ? { timeZone: "UTC", weekday: "short" }
      : { hour: "2-digit", minute: "2-digit", timeZone: "UTC" },
  ).format(timestamp);
}

export { timeLabel };
