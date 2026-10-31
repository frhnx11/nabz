import type { z } from "zod";
import { AGENT_ONLY_OUTCOME, OUTCOMES } from "../domain/constants";
import { extractionName, indexQuestionKeys, neutralValue, optionValues } from "./helpers";
import { PLATFORM_QA_CODES, RESERVED_KEYS } from "./constants";
import type { SurveyDefinitionBase } from "./schema";

type Def = z.infer<typeof SurveyDefinitionBase>;

/**
 * Cross-field rules a survey definition must satisfy. Each rule has a mutation test in
 * definitions.test.ts that breaks it and expects this function to complain.
 */
export function checkInvariants(def: Def, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });

  const unique = (keys: string[], what: string, path: string) => {
    const seen = new Set<string>();
    keys.forEach((k, i) => {
      if (seen.has(k)) issue([path, i], `duplicate ${what} "${k}"`);
      seen.add(k);
    });
  };

  // Keys are unique within each list.
  unique(
    def.questions.map((q) => q.key),
    "question key",
    "questions",
  );
  unique(
    def.indicators.map((i) => i.key),
    "indicator key",
    "indicators",
  );
  unique(
    def.dimensions.map((d) => d.key),
    "dimension key",
    "dimensions",
  );
  unique(
    def.cuts.map((c) => c.key),
    "cut key",
    "cuts",
  );
  unique(
    def.qa.rules.map((r) => r.code),
    "QA rule code",
    "qa",
  );
  unique(def.questions.map(extractionName), "extraction name", "questions");

  const questions = new Map(def.questions.map((q) => [q.key, q]));

  def.questions.forEach((q, i) => {
    if ((RESERVED_KEYS as readonly string[]).includes(q.key))
      issue(["questions", i, "key"], `"${q.key}" is reserved`);
    if ((RESERVED_KEYS as readonly string[]).includes(extractionName(q)))
      issue(["questions", i, "extraction"], `extraction name "${extractionName(q)}" is reserved`);
    if (q.askedWith !== undefined && (q.askedWith === q.key || !questions.has(q.askedWith)))
      issue(["questions", i, "askedWith"], `askedWith "${q.askedWith}" is not another question`);
    if (q.type === "number" && q.min >= q.max) issue(["questions", i], "min must be below max");
    const options = optionValues(q);
    if (q.extraction.optionHints) {
      for (const hint of Object.keys(q.extraction.optionHints)) {
        if (!options?.includes(hint))
          issue(["questions", i, "extraction", "optionHints"], `"${hint}" is not an option`);
      }
    }
    if (q.type === "choice") {
      unique(
        q.options.map((o) => o.value),
        "option",
        `questions.${i}.options`,
      );
      if (q.neutral !== undefined && !options?.includes(q.neutral))
        issue(["questions", i, "neutral"], `neutral "${q.neutral}" is not an option`);
    }
  });

  // Scoring rules reference the right kind of question, and map every option exactly once.
  def.indicators.forEach((ind, i) => {
    const q = questions.get(ind.rule.question);
    const path = ["indicators", i, "rule"];
    if (!q) return issue(path, `unknown question "${ind.rule.question}"`);
    if (ind.rule.kind === "map") {
      const options = optionValues(q);
      if (!options)
        return issue(path, `map rules need a trend, level or choice question, "${q.key}" is ${q.type}`);
      const mapped = Object.keys(ind.rule.scores).toSorted();
      if (mapped.join("|") !== [...options].toSorted().join("|"))
        issue(path, `scores must cover exactly the options of "${q.key}" (${options.join(", ")})`);
    } else if (q.type !== "number") {
      issue(path, `momentum rules need a number question, "${q.key}" is ${q.type}`);
    }
  });

  // The composite: known indicators, no repeats, weights summing to exactly 100.
  const indicators = new Map(def.indicators.map((ind) => [ind.key, ind]));
  const comps = def.composite.components;
  unique(
    comps.map((c) => c.indicator),
    "composite component",
    "composite",
  );
  comps.forEach((c, i) => {
    const ind = indicators.get(c.indicator);
    if (!ind) return issue(["composite", "components", i], `unknown indicator "${c.indicator}"`);
    // An inverted component is one where high values are bad news, and vice versa.
    if (c.invert !== (ind.goodWhen === "low"))
      issue(
        ["composite", "components", i, "invert"],
        `invert must be ${ind.goodWhen === "low"} for "${ind.key}"`,
      );
  });
  const total = comps.reduce((sum, c) => sum + c.weightPct, 0);
  if (total !== 100) issue(["composite", "components"], `weights must sum to 100, got ${total}`);
  if (def.composite.minComponents > comps.length)
    issue(["composite", "minComponents"], "minComponents exceeds the number of components");
  if (indicators.has(def.composite.key))
    issue(["composite", "key"], "composite key collides with an indicator");

  // Cuts: known dimensions, exactly one national cut, sane thresholds.
  const dims = new Set(def.dimensions.map((d) => d.key));
  let national = 0;
  def.cuts.forEach((cut, i) => {
    if (cut.dims.length === 0) national++;
    unique(cut.dims, "dimension", `cuts.${i}.dims`);
    for (const d of cut.dims) if (!dims.has(d)) issue(["cuts", i, "dims"], `unknown dimension "${d}"`);
    if (cut.lowNBelow !== null && cut.suppressBelow !== null && cut.suppressBelow > cut.lowNBelow)
      issue(["cuts", i], "suppressBelow cannot exceed lowNBelow");
  });
  if (national !== 1)
    issue(["cuts"], `exactly one cut must have no dimensions (national), found ${national}`);

  // QA rules reference questions of the right type.
  def.qa.rules.forEach((rule, i) => {
    const path = ["qa", "rules", i];
    if ((PLATFORM_QA_CODES as readonly string[]).includes(rule.code))
      issue(path, `"${rule.code}" is a platform QA code`);
    const need = (key: string, ok: (t: string) => boolean, what: string) => {
      const q = questions.get(key);
      if (!q) issue(path, `unknown question "${key}"`);
      else if (!ok(q.type)) issue(path, `"${key}" must be ${what}`);
      return q;
    };
    switch (rule.kind) {
      case "combination":
        for (const w of rule.when) {
          const q = need(
            w.question,
            (t) => ["trend", "level", "choice"].includes(t),
            "a trend, level or choice question",
          );
          if (q && !optionValues(q)?.includes(w.equals))
            issue(path, `"${w.equals}" is not an option of "${w.question}"`);
        }
        break;
      case "all_neutral":
        for (const key of rule.questions) {
          const q = questions.get(key);
          if (!q) issue(path, `unknown question "${key}"`);
          else if (neutralValue(q) === null) issue(path, `"${key}" has no neutral answer`);
        }
        break;
      case "trend_vs_number_change":
        need(rule.trend, (t) => t === "trend", "a trend question");
        need(rule.number, (t) => t === "number", "a number question");
        break;
      case "number_jump":
        need(rule.question, (t) => t === "number", "a number question");
        break;
    }
  });

  // The platform owns the outcome values; a definition only words them.
  for (const hint of Object.keys(def.operational.outcome.extraction.optionHints ?? {})) {
    if (hint !== AGENT_ONLY_OUTCOME && !(OUTCOMES as readonly string[]).includes(hint))
      issue(["operational", "outcome", "extraction", "optionHints"], `"${hint}" is not a platform outcome`);
  }

  const indexCount = indexQuestionKeys(def).length;
  if (def.qa.minAnsweredForUsable > indexCount)
    issue(["qa", "minAnsweredForUsable"], `cannot exceed the ${indexCount} index questions`);
  if (def.composite.minComponents > indexCount)
    issue(["composite", "minComponents"], `cannot exceed the ${indexCount} index questions`);
}
