// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

/**
 * OpenAI-compatible embeddings HTTP client.
 *
 * The OpenAI `/v1/embeddings` shape is the de-facto standard: works against
 * OpenAI directly and against local servers that expose the same surface
 * (LM Studio, vLLM, llama.cpp `--api`, Ollama's `/v1` shim, text-embeddings-
 * inference, etc.) with no code changes.
 *
 * Auth model: api_key_env (env var name) is preferred over api_key (literal
 * in config). When both are set, env wins. When neither is set, no
 * Authorization header is sent (typical for local servers).
 */

export interface EmbeddingsClientOptions {
  /** Base URL of the OpenAI-compatible server, e.g. "https://api.openai.com/v1". */
  endpoint: string;
  /** Model name passed in the request body. Required by the API. */
  model: string;
  /** Literal API key. Lower precedence than `api_key_env`. */
  api_key?: string | null;
  /** Name of an env var to read the API key from at call time. Wins over `api_key`. */
  api_key_env?: string | null;
  /** Per-request timeout in ms. Defaults to 60s. */
  timeout_ms?: number;
}

interface EmbeddingsResponse {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class EmbeddingsClient {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly api_key: string | null;
  private readonly api_key_env: string | null;
  private readonly timeout_ms: number;

  constructor(opts: EmbeddingsClientOptions) {
    // Trim trailing slashes via a single linear scan rather than a
    // /\/+$/ regex. The regex form is polynomial in the worst case (the
    // engine can probe O(n) starting positions, each requiring O(n)
    // suffix work) and CodeQL flags it on uncontrolled inputs. The
    // endpoint comes from config in normal use, but we'd rather not
    // bake a ReDoS surface in.
    let cut = opts.endpoint.length;
    while (cut > 0 && opts.endpoint.charCodeAt(cut - 1) === 0x2f /* '/' */) cut--;
    this.endpoint = opts.endpoint.slice(0, cut);
    this.model = opts.model;
    this.api_key = opts.api_key ?? null;
    this.api_key_env = opts.api_key_env ?? null;
    this.timeout_ms = opts.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  }

  /** Embed a single string. Convenience wrapper over `embedBatch`. */
  async embed(input: string): Promise<Float32Array> {
    const out = await this.requestEmbeddings(input);
    return out[0];
  }

  /**
   * Embed a list of strings in a single request. Order of returned vectors
   * matches input order (the OpenAI API guarantees this).
   */
  async embedBatch(inputs: string[]): Promise<Float32Array[]> {
    if (inputs.length === 0) return [];
    return this.requestEmbeddings(inputs);
  }

  private async requestEmbeddings(input: string | string[]): Promise<Float32Array[]> {
    const url = `${this.endpoint}/embeddings`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'accept': 'application/json',
    };
    const key = this.resolveApiKey();
    if (key) headers['authorization'] = `Bearer ${key}`;

    const body = JSON.stringify({ input, model: this.model });

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(this.timeout_ms),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`embeddings request failed: ${msg}`);
    }

    if (!res.ok) {
      // Do NOT include the raw response body in the thrown error: the
      // caller logs err.message, and a verbose or hostile endpoint can
      // echo our submitted document text, query text, or auth header
      // diagnostics into operator logs through that channel. Surface
      // only the structured error code/type from the OpenAI-shape error
      // envelope, length-capped to keep arbitrary strings out of logs.
      let providerDetail = '';
      try {
        const json = await res.json() as { error?: { code?: string; type?: string } };
        const tag = json?.error?.code ?? json?.error?.type;
        if (typeof tag === 'string' && tag.length > 0) {
          providerDetail = ` (${tag.slice(0, 64)})`;
        }
      } catch {
        /* response wasn't JSON — leave providerDetail empty */
      }
      throw new Error(`embeddings request failed: ${res.status} ${res.statusText}${providerDetail}`);
    }

    const payload = await res.json() as EmbeddingsResponse;
    if (!Array.isArray(payload.data) || payload.data.length === 0) {
      throw new Error('embeddings response missing `data` array');
    }
    return payload.data.map((item, i) => {
      if (!Array.isArray(item.embedding)) {
        throw new Error(`embeddings response item ${i} missing \`embedding\``);
      }
      return new Float32Array(item.embedding);
    });
  }

  private resolveApiKey(): string | null {
    if (this.api_key_env) {
      const fromEnv = process.env[this.api_key_env];
      if (fromEnv) return fromEnv;
    }
    return this.api_key;
  }
}
