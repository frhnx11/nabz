import { describe, expect, it } from "vitest";
import { CALLING_LIMITS } from "../calling-policy";
import { parseBatchForm } from "./form";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseBatchForm", () => {
  it("trims, de-duplicates members and treats empty notes as none", () => {
    expect(
      parseBatchForm({ name: "  Bengaluru two-wheelers ", notes: "  ", memberIds: [A, B, A] }),
    ).toEqual({
      ok: true,
      batch: { name: "Bengaluru two-wheelers", notes: null, memberIds: [A, B] },
    });
  });

  it("allows an empty batch", () => {
    expect(parseBatchForm({ name: "Later", memberIds: [] })).toMatchObject({ ok: true });
  });

  it("explains each problem on its field", () => {
    const r = parseBatchForm({ name: " ", notes: "x".repeat(501), memberIds: ["nope"] });
    expect(r).toEqual({
      ok: false,
      errors: {
        name: "Give the batch a name.",
        notes: "Keep it under 500 characters.",
        memberIds: "Unknown dealer.",
      },
    });
    expect(parseBatchForm({ name: "x".repeat(61), memberIds: [] })).toMatchObject({
      ok: false,
      errors: { name: "Keep it under 60 characters." },
    });
  });

  it("caps a batch at the dialer's hard limit", () => {
    const ids = Array.from(
      { length: CALLING_LIMITS.maxBatchSize + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(parseBatchForm({ name: "Big", memberIds: ids })).toMatchObject({
      ok: false,
      errors: { memberIds: `A batch can hold at most ${CALLING_LIMITS.maxBatchSize} dealers.` },
    });
  });
});
