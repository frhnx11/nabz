import { type CallingScope, NUMBER_NOT_ALLOWED, numberAllowed } from "../calling-policy";
import { normalisePhone } from "../domain/phone";

/**
 * The only code that talks to Bolna (ESLint enforces it). Every outbound call goes through
 * `makeCall`, which refuses unless calling is switched on and the calling scope allows the number.
 *
 * Kept free of `server-only` and env reads so scripts can use it: callers pass the settings in.
 */

const BASE_URL = "https://api.bolna.ai";

export class BolnaError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
    /** Seconds Bolna asked us to wait (Retry-After), if it said. */
    readonly retryAfterS: number | null = null,
  ) {
    super(message);
    this.name = "BolnaError";
  }
}

/** Refused before any request was sent: nothing was dialled. */
export class CallRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallRefused";
  }
}

export type BolnaUser = {
  id: string;
  name?: string;
  email?: string;
  wallet?: number;
  concurrency?: { max: number; current: number };
};

export type BolnaPhoneNumber = {
  id: string;
  phone_number: string;
  agent_id?: string | null;
  telephony_provider?: string;
  rented?: boolean;
};

export type BolnaAgentSummary = {
  id: string;
  agent_name: string;
  agent_status?: string;
  created_at?: string;
};

export type BolnaTtsProviders = {
  language: string;
  providers: {
    id: string;
    slug: string;
    is_supported: boolean;
    models: { id: string; model_id: string; display_name?: string; is_supported: boolean }[];
  }[];
};

export type BolnaVoice = {
  id: string;
  voice_id: string;
  name?: string;
  gender?: string | null;
  accent?: string | null;
  source?: string;
};

export type BolnaDisposition = {
  name: string;
  question: string;
  category?: string;
  model?: string;
  is_subjective?: boolean;
  is_objective?: boolean;
  subjective_type?: "text" | "timestamp" | "numeric" | "boolean" | "email" | "regex";
  objective_options?: { value: string; condition: string }[];
};

/** Statuses after which an execution won't change any more. */
export const TERMINAL_STATUSES = [
  "completed",
  "no-answer",
  "busy",
  "failed",
  "canceled",
  "stopped",
  "error",
  "balance-low",
] as const;

export type BolnaExecution = {
  id: string;
  agent_id: string;
  status: string;
  termination_reason?: string | null;
  error_message?: string | null;
  conversation_duration?: number | null;
  /** True when Bolna detected an answering machine. */
  answered_by_voice_mail?: boolean | null;
  /** When the call was placed. UTC, written without an offset. */
  initiated_at?: string | null;
  /** What we sent as `user_data`, echoed back in `recipient_data` (how an execution finds its dealer). */
  context_details?: { recipient_data?: Record<string, unknown> | null; [key: string]: unknown } | null;
  /** US cents. */
  total_cost?: number | null;
  transcript?: string | null;
  summary?: string | null;
  extracted_data?: Record<string, Record<string, Record<string, unknown>>> | null;
  cost_breakdown?: Record<string, number> | null;
  telephony_data?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type BolnaClientOptions = {
  apiKey: string;
  /** CALLING_ENABLED: the kill switch. */
  callingEnabled: boolean;
  /** NABZ_MODE and ALLOWED_NUMBERS: who can be called. */
  scope: CallingScope;
  fetch?: typeof fetch;
  /** Waits between retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
};

/** Retries after a 429, a 5xx or a network failure: 0.5 s, 1 s, 2 s (spec: exponential backoff). */
const RETRY_DELAYS_MS = [500, 1000, 2000];
const MAX_RETRY_AFTER_MS = 10_000;

function retryable(error: unknown): boolean {
  if (error instanceof BolnaError) return error.status === 429 || error.status >= 500;
  // fetch() itself failed (no response at all): a network problem worth another try.
  return error instanceof TypeError;
}

/** Bolna's Retry-After (seconds), if it sent one we should honour. */
function retryAfterMs(error: unknown): number | null {
  if (!(error instanceof BolnaError) || error.retryAfterS === null) return null;
  return Math.min(error.retryAfterS * 1000, MAX_RETRY_AFTER_MS);
}

/** Why a number can't be called, or null if it can. Checked again inside makeCall. */
export function callRefusal(to: string, options: Pick<BolnaClientOptions, "callingEnabled" | "scope">): string | null {
  if (!options.callingEnabled) return "Calling is switched off (CALLING_ENABLED is not true).";
  const phone = normalisePhone(to);
  if (!phone) return "Not a valid phone number.";
  if (!numberAllowed(phone.e164, options.scope)) return NUMBER_NOT_ALLOWED;
  return null;
}

export function createBolnaClient(options: BolnaClientOptions) {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function send<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await doFetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: keep the text.
    }
    if (!response.ok) {
      const message =
        parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as { message: unknown }).message)
          : text.slice(0, 300);
      const header = response.headers.get("retry-after");
      const retryAfter = header === null || header.trim() === "" ? NaN : Number(header);
      throw new BolnaError(
        response.status,
        `Bolna ${method} ${path} → ${response.status}: ${message}`,
        parsed,
        Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
      );
    }
    return parsed as T;
  }

  /**
   * One request. Reads (and the free, side-effect-free extraction test) are retried on 429, 5xx and
   * network failures. Anything that creates something is sent once: above all POST /call, so a call
   * can never be placed twice.
   */
  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    { retry = method === "GET" }: { retry?: boolean } = {},
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await send<T>(method, path, body);
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (!retry || delay === undefined || !retryable(error)) throw error;
        await sleep(retryAfterMs(error) ?? delay);
      }
    }
  }

  return {
    me: () => request<BolnaUser>("GET", "/user/me"),
    phoneNumbers: () => request<BolnaPhoneNumber[]>("GET", "/phone-numbers/all"),
    agents: () => request<BolnaAgentSummary[]>("GET", "/v2/agent/all"),
    /** One agent's full configuration, as Bolna stores it. Free. */
    getAgent: (agentId: string) =>
      request<Record<string, unknown>>("GET", `/v2/agent/${encodeURIComponent(agentId)}`),
    ttsProviders: (language: string) =>
      request<BolnaTtsProviders>("GET", `/api/v1/voice-config/tts?language=${encodeURIComponent(language)}`),
    voices: (providerId: string, modelId: string, language: string) =>
      request<{ items: BolnaVoice[] }>(
        "GET",
        `/api/v1/voice-config/tts/voices?provider_id=${providerId}&model_id=${modelId}&language=${encodeURIComponent(language)}&page_size=100`,
      ),
    createAgent: (body: unknown) =>
      request<{ agent_id: string; state: string; version_id?: string }>("POST", "/v2/agent", body),
    createDispositions: (agentId: string, dispositions: BolnaDisposition[]) =>
      request<{ message: string; ids: string[] }>("POST", "/dispositions/bulk", {
        agent_id: agentId,
        dispositions,
      }),
    getExecution: (executionId: string) =>
      request<BolnaExecution>("GET", `/executions/${encodeURIComponent(executionId)}`),
    /**
     * Runs an agent's extractions on a transcript, without a call. Free. The fallback when Bolna's own
     * extraction of a finished call comes back empty.
     */
    testExtractions: (agentId: string, transcript: string) =>
      request<{ extracted_data?: BolnaExecution["extracted_data"] }>(
        "POST",
        `/v2/agent/${encodeURIComponent(agentId)}/dispositions/test`,
        { transcript },
        { retry: true },
      ),

    /** Places one outbound call. Refuses (throws CallRefused, nothing dialled) unless allowed. */
    async makeCall(call: { agentId: string; to: string; userData?: Record<string, string> }) {
      const refusal = callRefusal(call.to, options);
      if (refusal) throw new CallRefused(`Call refused: ${refusal}`);
      const phone = normalisePhone(call.to)!;
      return request<{ message: string; status: string; execution_id: string }>("POST", "/call", {
        agent_id: call.agentId,
        recipient_phone_number: phone.e164,
        ...(call.userData ? { user_data: call.userData } : {}),
      });
    },
  };
}

export type BolnaClient = ReturnType<typeof createBolnaClient>;
