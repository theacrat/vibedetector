import type { Range } from "@/domain";

function timeLabel(timestamp: number, range: Range, timeZone = "UTC") {
  return new Intl.DateTimeFormat(
    "en-GB",
    range === "7d"
      ? { timeZone, weekday: "short" }
      : { hour: "2-digit", minute: "2-digit", timeZone },
  ).format(timestamp);
}

export { timeLabel };
