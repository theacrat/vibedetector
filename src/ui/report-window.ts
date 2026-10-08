const hour = 3_600_000;

function reportingWindowDelay(window: number, now: number) {
  return Math.max(0, (window + 1) * hour - now);
}

export { reportingWindowDelay };
