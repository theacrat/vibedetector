interface DocumentMetadata {
  modelId: string;
  snapshots: string[];
  inputModalities: string[] | undefined;
  outputModalities: string[] | undefined;
  contextWindow: number | undefined;
  maxOutputTokens: number | undefined;
  defaultSnapshot: string | undefined;
  endpoints: Record<string, boolean>;
}

function section(markdown: string, heading: string): string {
  const sections = markdown.split(`\n## ${heading}\n`);
  if (sections.length !== 2) {
    throw new Error("Invalid documentation structure");
  }
  return sections[1]?.split("\n## ")[0] ?? "";
}

function modalities(details: string, label: string): string[] {
  const matches = [...details.matchAll(new RegExp(`^- ${label}: (?<value>.+)$`, "gmu"))];
  const values = matches[0]?.groups?.["value"]?.split(", ");
  if (
    matches.length !== 1 ||
    !values ||
    values.length === 0 ||
    new Set(values).size !== values.length ||
    values.some((value) => !["text", "image", "audio", "video"].includes(value))
  ) {
    throw new Error("Invalid documented modalities");
  }
  return values;
}

function tokenCount(details: string, label: string): number | undefined {
  const lines = details.split("\n").filter((line) => line.includes(label));
  if (lines.length === 0) {
    return;
  }
  const value = new RegExp(
    `^- (?<value>(?:[1-9]\\d*|[1-9]\\d{0,2}(?:,\\d{3})+)) ${label}$`,
    "u",
  ).exec(lines[0] ?? "")?.groups?.["value"];
  const count = Number(value?.replaceAll(",", ""));
  if (lines.length !== 1 || !Number.isSafeInteger(count) || count <= 0) {
    throw new Error("Invalid documented token count");
  }
  return count;
}

function endpoints(markdown: string): Record<string, boolean> {
  const lines = section(markdown, "Endpoints").trim().split("\n");
  if (
    lines[0] !== "| Endpoint | Route | Support |" ||
    lines[1] !== "| --- | --- | --- |" ||
    lines.length < 3
  ) {
    throw new Error("Invalid documented endpoint table");
  }
  const result: Record<string, boolean> = {};
  for (const line of lines.slice(2)) {
    const groups =
      /^\| [^|]+ \| `(?<route>v1\/[a-z0-9_/-]+)` \| (?<support>Supported|Not supported) \|$/u.exec(
        line,
      )?.groups;
    const route = groups?.["route"];
    if (!route || route in result) {
      throw new Error("Invalid documented endpoint row");
    }
    result[route] = groups?.["support"] === "Supported";
  }
  return result;
}

function parseDocument(markdown: string): DocumentMetadata {
  const modelId = /^Model ID: `(?<modelId>[^`]+)`$/mu.exec(markdown)?.groups?.["modelId"];
  if (!modelId) {
    throw new Error("Missing documented model ID");
  }
  const details = section(markdown, "Model details");
  const snapshots = [
    ...section(markdown, "Snapshots").matchAll(/^- `(?<snapshot>[^`]+)`$/gmu),
  ].flatMap((match) => (match.groups?.["snapshot"] ? [match.groups["snapshot"]] : []));
  if (snapshots.length === 0) {
    throw new Error("Missing documented snapshots");
  }
  const defaultSnapshot = /^- Default snapshot: `(?<snapshot>[^`]+)`$/mu.exec(details)?.groups?.[
    "snapshot"
  ];
  if (!defaultSnapshot || !snapshots.includes(defaultSnapshot)) {
    throw new Error("Invalid documented default snapshot");
  }
  return {
    contextWindow: tokenCount(details, "context window"),
    defaultSnapshot,
    endpoints: endpoints(markdown),
    inputModalities: modalities(details, "Input modalities"),
    maxOutputTokens: tokenCount(details, "max output tokens"),
    modelId,
    outputModalities: modalities(details, "Output modalities"),
    snapshots,
  };
}

export { parseDocument };
export type { DocumentMetadata };
