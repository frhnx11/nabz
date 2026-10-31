/**
 * Vehicle Dealer Pulse v2: the owner's new call script ("Nabz call scripts NEW.md", 29 Oct 2026), as
 * spoken by the call-lab agents (hi04, en01, ta02, bn01, …). Same six questions, values, indicators,
 * weights, cuts and QA as v1, so answers stay comparable. What changed is what is asked:
 * - bookings is two questions (the trend, then "roughly how many bookings this week?");
 * - stock is "at today's selling pace"; discounts are "compared with last week";
 * - loans are "compared with last month: more / the same / less", stored as high / normal / low
 *   (the values every agent returns), so credit stress now reads as a month-on-month change.
 */
import { SurveyDefinition, type SurveyDefinitionInput } from "../schema";

const TREND_HINTS = {
  up: "The dealer said it increased (badhi, zyada, upar).",
  same: "The dealer said it stayed about the same (utni hi, same, barabar).",
  down: "The dealer said it decreased (kam hui, ghati, neeche).",
};

const raw = {
  schemaVersion: 1,
  slug: "vehicle_pulse",
  version: 2,
  sector: "vehicles",
  kind: "pulse",
  cadence: "weekly",
  title: { en: "Vehicle Dealer Pulse", hinglish: "Vehicle Dealer Pulse" },

  questions: [
    {
      key: "enquiries_trend",
      type: "trend",
      label: { en: "Enquiries vs last week", hinglish: "Enquiries" },
      ask: {
        en: "Were enquiries this week higher than last week, the same, or lower?",
        hinglish: "Pichhle hafte se is hafte enquiries zyada aayin, utni hi, ya kam?",
      },
      extraction: {
        instruction:
          "Did the dealer say customer enquiries (showroom walk-ins and phone enquiries) this week went up, stayed the same, or went down compared with last week? Leave empty if they did not answer.",
        optionHints: TREND_HINTS,
      },
    },
    {
      key: "bookings_trend",
      type: "trend",
      label: { en: "Bookings vs last week", hinglish: "Bookings" },
      ask: {
        en: "And bookings: compared with last week, more, the same, or fewer?",
        hinglish: "Aur bookings, pichhle hafte se zyada, utni hi, ya kam?",
      },
      extraction: {
        instruction:
          "Did the dealer say vehicle bookings this week were more, the same, or fewer than last week? This is the comparison, not the number. Leave empty if they did not answer.",
        optionHints: TREND_HINTS,
      },
    },
    {
      key: "bookings_week",
      type: "number",
      label: { en: "Bookings this week", hinglish: "Is hafte ki bookings" },
      ask: { en: "Roughly how many bookings this week?", hinglish: "Is hafte lagbhag kitni bookings huin?" },
      min: 0,
      max: 2000,
      integer: true,
      unit: "count",
      extraction: {
        instruction:
          'The approximate number of bookings the dealer said they took this week, as a whole number using digits only. It may come with the bookings comparison ("fewer, about 25" is 25). If they gave a range, use its midpoint (for example 40 to 50 becomes 45). Leave empty if no number was given.',
      },
    },
    {
      key: "stock_days",
      type: "number",
      label: { en: "Days of stock", hinglish: "Stock kitne din ka" },
      ask: {
        en: "At today's selling pace, how many days will your current stock last?",
        hinglish: "Abhi ki bikri ke hisaab se, abhi ka stock kitne din chalega?",
      },
      min: 0,
      max: 365,
      integer: true,
      unit: "days",
      extraction: {
        instruction:
          'How many days the dealer said their current vehicle stock will last at today\'s selling pace, as a whole number of days using digits only. Convert spoken durations: "ek hafta" = 7, "do hafte" = 14, "ek mahina" = 30, "dedh mahina" = 45, "do mahine" = 60. Leave empty if they did not answer.',
      },
    },
    {
      key: "discount_trend",
      type: "trend",
      label: { en: "Discounts and offers", hinglish: "Discount aur offers" },
      ask: {
        en: "Discounts and offers: compared with last week, going up, the same, or coming down?",
        hinglish: "Discount aur offers, pichhle hafte se badh rahe hain, utne hi hain, ya kam ho rahe hain?",
      },
      extraction: {
        instruction:
          "Did the dealer say the discounts and offers they give customers are, compared with last week, going up, about the same, or coming down? Leave empty if they did not answer.",
        optionHints: TREND_HINTS,
      },
    },
    {
      key: "loan_rejections",
      type: "level",
      label: { en: "Loan rejections vs last month", hinglish: "Loan reject, pichhle mahine se" },
      ask: {
        en: "Last one: compared with last month, are customers' loans getting rejected more, the same, or less?",
        hinglish:
          "Aakhri sawaal: pichhle mahine se, customers ke loan reject zyada ho rahe hain, utne hi, ya kam?",
      },
      extraction: {
        instruction:
          "Did the dealer say their customers' vehicle loan rejections, compared with last month, are happening more (high), about the same (normal), or less (low)? Leave empty if they did not answer.",
        optionHints: {
          high: "More rejections than last month (zyada ho rahe hain).",
          normal: "About the same as last month (utne hi).",
          low: "Fewer rejections than last month (kam ho rahe hain).",
        },
      },
    },
  ],

  operational: {
    outcome: {
      extraction: {
        instruction:
          "How the call ended. completed: answered all the survey questions. partial: answered some but not all. refused: declined to take part. callback: asked to be called at another time. opted_out: asked not to be called again (for example 'call mat karna', 'dobara phone mat karna'). wrong_number: not a vehicle dealership or the wrong business.",
        optionHints: {
          completed: "Answered all the survey questions.",
          partial: "Answered some survey questions but not all.",
          refused: "Declined to take part, without asking for a callback or to stop calls.",
          callback: "Asked to be called back at another time.",
          opted_out: "Asked not to be called again.",
          wrong_number: "Not a vehicle dealership, or the wrong business or person entirely.",
        },
      },
    },
    callbackTime: {
      extraction: {
        instruction:
          "If the person asked to be called back, the day and time they asked for, in their own words (for example 'kal shaam 5 baje'). Leave empty otherwise.",
      },
    },
  },

  indicators: [
    {
      key: "enquiries",
      label: { en: "Enquiries", hinglish: "Enquiries" },
      description: {
        en: "Dealers reporting more customer enquiries than last week. 50 means no change.",
        hinglish: "Kitne dealers ke yahan enquiries badhi. 50 matlab koi badlav nahi.",
      },
      rule: { kind: "map", question: "enquiries_trend", scores: { up: 100, same: 50, down: 0 } },
      goodWhen: "high",
    },
    {
      key: "bookings",
      label: { en: "Bookings momentum", hinglish: "Bookings" },
      description: {
        en: "Dealers reporting more bookings than last week. 50 means no change.",
        hinglish: "Kitne dealers ki bookings badhi. 50 matlab koi badlav nahi.",
      },
      rule: { kind: "map", question: "bookings_trend", scores: { up: 100, same: 50, down: 0 } },
      goodWhen: "high",
    },
    {
      key: "stock",
      label: { en: "Stock momentum", hinglish: "Stock" },
      description: {
        en: "Stock clearing versus piling up, from each dealer's days of stock against their own answer last week (±5%). Above 50 means stock is clearing.",
        hinglish: "Stock kam ho raha hai ya jama ho raha hai, har dealer ke pichhle hafte ke jawab se.",
      },
      rule: {
        kind: "momentum",
        question: "stock_days",
        tolerancePct: 5,
        score: { fell: 100, within: 50, rose: 0 },
      },
      goodWhen: "high",
    },
    {
      key: "discount_pressure",
      label: { en: "Discount pressure", hinglish: "Discount pressure" },
      description: {
        en: "Dealers reporting rising discounts and offers. Above 50 means more discounting, a sign of weaker demand.",
        hinglish: "Kitne dealers ke discount badh rahe hain. 50 se upar matlab zyada discount.",
      },
      rule: { kind: "map", question: "discount_trend", scores: { up: 100, same: 50, down: 0 } },
      goodWhen: "low",
    },
    {
      key: "credit_stress",
      label: { en: "Credit stress", hinglish: "Loan stress" },
      description: {
        en: "Dealers reporting more loan rejections than last month. Above 50 means financing is getting harder to get.",
        hinglish: "Kitne dealers ke yahan loan reject pichhle mahine se zyada ho rahe hain.",
      },
      rule: { kind: "map", question: "loan_rejections", scores: { high: 100, normal: 50, low: 0 } },
      goodWhen: "low",
    },
  ],

  composite: {
    key: "demand",
    label: { en: "Demand index", hinglish: "Demand index" },
    minComponents: 2,
    components: [
      { indicator: "enquiries", weightPct: 25, invert: false },
      { indicator: "bookings", weightPct: 25, invert: false },
      { indicator: "stock", weightPct: 20, invert: false },
      { indicator: "discount_pressure", weightPct: 15, invert: true },
      { indicator: "credit_stress", weightPct: 15, invert: true },
    ],
  },

  dimensions: [
    {
      key: "brand",
      label: { en: "Brand", hinglish: "Brand" },
      source: { kind: "attribute", attribute: "brand" },
    },
    {
      key: "segment",
      label: { en: "Segment", hinglish: "Segment" },
      source: { kind: "attribute", attribute: "segment" },
    },
    { key: "state", label: { en: "State", hinglish: "State" }, source: { kind: "geo", field: "state" } },
    { key: "region", label: { en: "Region", hinglish: "Region" }, source: { kind: "geo", field: "region" } },
    {
      key: "city_tier",
      label: { en: "City tier", hinglish: "City tier" },
      source: { kind: "geo", field: "city_tier" },
    },
  ],

  cuts: [
    {
      key: "national",
      label: { en: "All India", hinglish: "All India" },
      dims: [],
      poolWeeks: 1,
      lowNBelow: null,
      suppressBelow: null,
    },
    {
      key: "brand",
      label: { en: "By brand", hinglish: "Brand" },
      dims: ["brand"],
      poolWeeks: 1,
      lowNBelow: 5,
      suppressBelow: null,
    },
    {
      key: "state",
      label: { en: "By state", hinglish: "State" },
      dims: ["state"],
      poolWeeks: 1,
      lowNBelow: 5,
      suppressBelow: null,
    },
    {
      key: "segment",
      label: { en: "By segment", hinglish: "Segment" },
      dims: ["segment"],
      poolWeeks: 1,
      lowNBelow: 5,
      suppressBelow: null,
    },
    {
      key: "city_tier",
      label: { en: "By city tier", hinglish: "City tier" },
      dims: ["city_tier"],
      poolWeeks: 1,
      lowNBelow: 5,
      suppressBelow: null,
    },
    {
      key: "region",
      label: { en: "By region", hinglish: "Region" },
      dims: ["region"],
      poolWeeks: 1,
      lowNBelow: 5,
      suppressBelow: null,
    },
    {
      key: "brand_state",
      label: { en: "Brand × state", hinglish: "Brand × state" },
      dims: ["brand", "state"],
      poolWeeks: 2,
      lowNBelow: 5,
      suppressBelow: 3,
    },
  ],

  qa: {
    minDurationSec: 40,
    minConfidence: 0.5,
    minAnsweredForUsable: 2,
    rules: [
      {
        kind: "combination",
        code: "contradiction",
        severity: "warn",
        when: [
          { question: "enquiries_trend", equals: "down" },
          { question: "bookings_trend", equals: "up" },
        ],
      },
      {
        kind: "all_neutral",
        code: "straightlining",
        severity: "warn",
        questions: ["enquiries_trend", "bookings_trend", "discount_trend", "loan_rejections"],
      },
      {
        kind: "trend_vs_number_change",
        code: "bookings_mismatch",
        severity: "warn",
        trend: "bookings_trend",
        number: "bookings_week",
        tolerancePct: 5,
      },
      { kind: "number_jump", code: "stock_jump", severity: "warn", question: "stock_days", factor: 3 },
    ],
  },
} satisfies SurveyDefinitionInput;

/** Vehicle Dealer Pulse, version 2. Frozen once used: change it by adding vehicle-pulse.v3.ts. */
export const vehiclePulseV2: SurveyDefinition = SurveyDefinition.parse(raw);
