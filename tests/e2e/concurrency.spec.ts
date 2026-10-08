import { expect, test } from "@playwright/test";

test("concurrent verified requests retain one contribution in the local Worker", async ({
  request,
}) => {
  const session = await request.get("/api/session/deepseek");
  expect(session.ok()).toBe(true);
  const identity: unknown = await session.json();
  if (
    typeof identity !== "object" ||
    identity === null ||
    !("window" in identity) ||
    typeof identity.window !== "number"
  ) {
    throw new Error("Session must contain its reporting window");
  }
  const before = await request.get("/api/providers/deepseek?range=24h");
  const initial: unknown = await before.json();
  if (
    typeof initial !== "object" ||
    initial === null ||
    !("hourly" in initial) ||
    typeof initial.hourly !== "number"
  ) {
    throw new Error("Dashboard response must contain an hourly count");
  }
  const responses = await Promise.all(
    Array.from({ length: 4 }, async () =>
      request.post("/api/reports/deepseek", {
        data: { category: "slow", token: "XXXX.DUMMY.TOKEN.XXXX", window: identity.window },
        headers: { Origin: "http://127.0.0.1:41873" },
      }),
    ),
  );
  expect(responses.every((response) => response.ok())).toBe(true);
  const finalResponse = await request.get("/api/providers/deepseek?range=24h");
  const after: unknown = await finalResponse.json();
  if (typeof after !== "object" || after === null || !("hourly" in after)) {
    throw new Error("Dashboard response must contain an hourly count");
  }
  expect(after.hourly).toBe(initial.hourly + 1);
  const undo = await request.post("/api/reports/deepseek", {
    // SQL/JSON use null to represent a retracted report.
    // eslint-disable-next-line unicorn/no-null
    data: { category: null, token: "XXXX.DUMMY.TOKEN.XXXX", window: identity.window },
    headers: { Origin: "http://127.0.0.1:41873" },
  });
  expect(undo.ok()).toBe(true);
});
