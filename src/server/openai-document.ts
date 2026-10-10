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
  return markdown.split(`\n## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";
}

function parseDocument(markdown: string): DocumentMetadata {
  const modelId = /^Model ID: `(?<modelId>[^`]+)`$/mu.exec(markdown)?.groups?.["modelId"];
  if (!modelId) {
    throw new Error("Missing documented model ID");
  }
  const details = section(markdown, "Model details");
  const modalities = (label: string) =>
    new RegExp(`^- ${label}: (?<value>.+)$`, "mu").exec(details)?.groups?.["value"]?.split(", ");
  const integer = (label: string) => {
    const value = new RegExp(`^- (?<value>[\\d,]+) ${label}$`, "mu").exec(details)?.groups?.[
      "value"
    ];
    if (!value) {
      return;
    }
    const result = Number(value.replaceAll(",", ""));
    if (!Number.isSafeInteger(result) || result <= 0) {
      throw new Error("Invalid documented token count");
    }
    return result;
  };
  const endpoints: Record<string, boolean> = {};
  for (const match of section(markdown, "Endpoints").matchAll(
    /^\| [^|]+ \| `(?<route>[^`]+)` \| (?<support>Supported|Not supported) \|$/gmu,
  )) {
    if (match.groups?.["route"]) {
      endpoints[match.groups["route"]] = match.groups["support"] === "Supported";
    }
  }
  return {
    contextWindow: integer("context window"),
    defaultSnapshot: /^- Default snapshot: `(?<snapshot>[^`]+)`$/mu.exec(details)?.groups?.[
      "snapshot"
    ],
    endpoints,
    inputModalities: modalities("Input modalities"),
    maxOutputTokens: integer("max output tokens"),
    modelId,
    outputModalities: modalities("Output modalities"),
    snapshots: [...section(markdown, "Snapshots").matchAll(/^- `(?<snapshot>[^`]+)`$/gmu)].flatMap(
      (match) => (match.groups?.["snapshot"] ? [match.groups["snapshot"]] : []),
    ),
  };
}

export { parseDocument };
export type { DocumentMetadata };
