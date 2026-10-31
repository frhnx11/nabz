import { describe, expect, it, vi } from "vitest";
import type { CallingScope } from "../calling-policy";
import { CallRefused, callRefusal, createBolnaClient } from "./client";

const OWNER = "+919000012345";
const SCOPE: CallingScope = { mode: "testing", allowedNumbers: [OWNER, "+919000054321"] };
const PRODUCTION: CallingScope = { mode: "production", allowedNumbers: [] };

describe("Bolna client call guard", () => {
  it("in testing, allows only an allowed number with calling switched on", () => {
    expect(callRefusal(OWNER, { callingEnabled: true, scope: SCOPE })).toBeNull();
    expect(callRefusal("+91 90000 12345", { callingEnabled: true, scope: SCOPE })).toBeNull();
    expect(callRefusal("+919000054321", { callingEnabled: true, scope: SCOPE })).toBeNull();
    expect(callRefusal(OWNER, { callingEnabled: false, scope: SCOPE })).toMatch(/switched off/);
    expect(callRefusal("+919876543210", { callingEnabled: true, scope: SCOPE })).toMatch(
      /NABZ_MODE=production/,
    );
    expect(callRefusal("not a number", { callingEnabled: true, scope: SCOPE })).toMatch(/valid/);
  });

  it("in production, allows any valid number but still needs calling on", () => {
    expect(callRefusal("+919876543210", { callingEnabled: true, scope: PRODUCTION })).toBeNull();
    expect(callRefusal("+919876543210", { callingEnabled: false, scope: PRODUCTION })).toMatch(
      /switched off/,
    );
    expect(callRefusal("not a number", { callingEnabled: true, scope: PRODUCTION })).toMatch(/valid/);
  });

  it("refuses before sending anything to Bolna", async () => {
    const fetch = vi.fn();
    const bolna = createBolnaClient({ apiKey: "k", callingEnabled: true, scope: SCOPE, fetch });
    await expect(bolna.makeCall({ agentId: "a", to: "+919876543210" })).rejects.toBeInstanceOf(CallRefused);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the normalised number when allowed", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ message: "done", status: "queued", execution_id: "e1" })),
    );
    const bolna = createBolnaClient({ apiKey: "k", callingEnabled: true, scope: SCOPE, fetch });
    await expect(bolna.makeCall({ agentId: "a", to: "+91 90000 12345" })).resolves.toMatchObject({
      execution_id: "e1",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.bolna.ai/call");
    expect(JSON.parse(String(init.body))).toEqual({ agent_id: "a", recipient_phone_number: OWNER });
  });
});

describe("Bolna client retries", () => {
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

  function client(responses: (Response | Error)[]) {
    const fetch = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      if (next instanceof Error) throw next;
      return next;
    });
    const sleep = vi.fn(async (_ms: number) => {});
    const bolna = createBolnaClient({ apiKey: "k", callingEnabled: true, scope: SCOPE, fetch, sleep });
    return { bolna, fetch, sleep };
  }

  it("retries a read after a server error or a network failure, with growing waits", async () => {
    const { bolna, fetch, sleep } = client([
      json({ message: "busy" }, 503),
      new TypeError("fetch failed"),
      json({ id: "e1", agent_id: "a", status: "completed" }),
    ]);
    await expect(bolna.getExecution("e1")).resolves.toMatchObject({ id: "e1" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it("gives up after three retries", async () => {
    const { bolna, fetch } = client([500, 502, 503, 504].map((s) => json({ message: "down" }, s)));
    await expect(bolna.getExecution("e1")).rejects.toMatchObject({ status: 504 });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("honours Retry-After on 429", async () => {
    const { bolna, sleep } = client([
      json({ message: "slow down" }, 429, { "Retry-After": "3" }),
      json({ id: "a" }),
    ]);
    await bolna.getAgent("a");
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("doesn't retry a request Bolna rejected", async () => {
    const { bolna, fetch } = client([json({ message: "not found" }, 404)]);
    await expect(bolna.getExecution("nope")).rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries the free extraction test", async () => {
    const { bolna, fetch } = client([
      json({ message: "busy" }, 503),
      json({ extracted_data: { Pulse: {} } }),
    ]);
    await expect(bolna.testExtractions("a", "user: haan")).resolves.toEqual({
      extracted_data: { Pulse: {} },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.bolna.ai/v2/agent/a/dispositions/test");
    expect(JSON.parse(String(init.body))).toEqual({ transcript: "user: haan" });
  });

  it("never retries placing a call, so a call can't be placed twice", async () => {
    for (const failure of [json({ message: "busy" }, 503), new TypeError("fetch failed")]) {
      const { bolna, fetch, sleep } = client([failure, json({ execution_id: "e2" })]);
      await expect(bolna.makeCall({ agentId: "a", to: OWNER })).rejects.toBeDefined();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });
});
