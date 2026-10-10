const GEMINI_SOURCE = "https://ai.google.dev/gemini-api/docs/models";

const geminiTasks = new Map<string, string>([
  ["gemini-2.5-flash-preview-tts", "speech-generation"],
  ["gemini-2.5-pro-preview-tts", "speech-generation"],
  ["gemini-3.1-flash-tts-preview", "speech-generation"],
  ["gemini-3.8-flash-tts", "speech-generation"],
  ["gemini-3.8-flash-lite-tts", "speech-generation"],
  ["gemini-3.5-transcribe", "transcription"],
  ["gemini-3.5-transcribe-live", "transcription"],
  ["gemini-omni-1.1-flash", "video-generation"],
  ["gemini-omni-flash-preview", "video-generation"],
]);

const geminiLifecycle = new Map<string, { task: string; source: string }>([
  [
    "gemini-3.1-flash-lite-preview",
    { source: "https://ai.google.dev/gemini-api/docs/deprecations", task: "shutdown" },
  ],
  [
    "gemini-2.5-computer-use-preview-10-2025",
    { source: "https://ai.google.dev/gemini-api/docs/deprecations", task: "shutdown" },
  ],
  [
    "gemini-3-pro-preview",
    { source: "https://ai.google.dev/gemini-api/docs/deprecations", task: "shutdown" },
  ],
  [
    "gemini-3.1-flash-image-preview",
    { source: "https://ai.google.dev/gemini-api/docs/deprecations", task: "shutdown" },
  ],
  [
    "gemini-3-pro-image-preview",
    { source: "https://ai.google.dev/gemini-api/docs/deprecations", task: "shutdown" },
  ],
  [
    "antigravity-preview-05-2026",
    { source: "https://ai.google.dev/gemini-api/docs/deprecations", task: "shutdown" },
  ],
  [
    "deep-research-pro-preview-12-2025",
    { source: "https://ai.google.dev/gemini-api/docs/changelog", task: "deprecated" },
  ],
  [
    "gemini-3.7-flash",
    { source: "https://ai.google.dev/gemini-api/docs/changelog", task: "deprecated" },
  ],
  [
    "gemini-3.5-flash",
    { source: "https://ai.google.dev/gemini-api/docs/changelog", task: "deprecated" },
  ],
]);

const geminiReleases = new Map<string, string>([
  ["gemini-3.8-flash", "2026-09-02"],
  ["gemini-3.6-flash", "2026-07-21"],
  ["gemini-3.5-flash-lite", "2026-07-21"],
  ["gemini-3.1-flash-lite", "2026-05-07"],
  ["gemini-3.1-pro-preview", "2026-02-19"],
  ["gemini-3.1-pro-preview-customtools", "2026-02-19"],
  ["gemini-3-flash-preview", "2025-12-17"],
  ["gemini-2.5-flash", "2025-06-17"],
  ["gemini-2.5-pro", "2025-06-17"],
  ["gemini-2.5-flash-lite", "2025-07-22"],
  ["gemma-4-26b-a4b-it", "2026-04-02"],
  ["gemma-4-31b-it", "2026-04-02"],
  ["gemini-robotics-er-2-preview", "2026-07-30"],
  ["gemini-nano-banana-2.1", "2026-10-06"],
  ["gemini-3.1-flash-lite-image", "2026-06-30"],
  ["gemini-3-pro-image", "2026-05-28"],
  ["gemini-2.5-flash-image", "2025-10-02"],
  ["deep-research-preview-04-2026", "2026-04-21"],
  ["deep-research-max-preview-04-2026", "2026-04-21"],
  ["antigravity-preview-09-2026", "2026-09-17"],
]);

function documentedGeminiRelease(id: string): { releasedAt: number; source: string } | undefined {
  const date = geminiReleases.get(id.replace(/^models\//u, ""));
  return date
    ? { releasedAt: Date.parse(date), source: "https://ai.google.dev/gemini-api/docs/changelog" }
    : undefined;
}

function documentedGeminiTask(id: string): { task: string; source: string } | undefined {
  const exactId = id.replace(/^models\//u, "");
  const lifecycle = geminiLifecycle.get(exactId);
  if (lifecycle) {
    return lifecycle;
  }
  const task = geminiTasks.get(exactId);
  return task ? { source: GEMINI_SOURCE, task } : undefined;
}

export { documentedGeminiRelease, documentedGeminiTask };
