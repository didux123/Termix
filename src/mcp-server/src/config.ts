import { z } from "zod";

/**
 * Runtime configuration for the Termix MCP server, sourced entirely from
 * environment variables. At least one authentication method must be provided:
 * an API key (for read-only, non-encrypted data) and/or a username + password
 * (required for anything that touches encrypted data — hosts, credentials,
 * command execution).
 */
const configSchema = z
  .object({
    /** Base URL of the Termix instance (the nginx entrypoint, not an internal port). */
    url: z.string().url(),
    /** API key (tmx_...) used for read-only, non-encrypted endpoints. */
    apiKey: z.string().optional(),
    /** Username for JWT login (encrypted-data operations). */
    username: z.string().optional(),
    /** Password for JWT login. */
    password: z.string().optional(),
    /** Optional TOTP code, if the account has 2FA enabled. */
    totpCode: z.string().optional(),
    /** Accept self-signed TLS certificates (test instances only). */
    insecureTls: z.boolean().default(false),
    /** Per-request timeout in milliseconds. */
    requestTimeoutMs: z.number().int().positive().default(60000),
  })
  .refine((c) => Boolean(c.apiKey) || Boolean(c.username && c.password), {
    message: "Provide TERMIX_API_KEY and/or TERMIX_USERNAME + TERMIX_PASSWORD.",
  });

export type TermixConfig = z.infer<typeof configSchema>;

/**
 * Read and validate configuration from the environment. Throws a readable
 * error (listing what is missing) when the configuration is invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): TermixConfig {
  const parsed = configSchema.safeParse({
    url: env.TERMIX_URL,
    apiKey: env.TERMIX_API_KEY || undefined,
    username: env.TERMIX_USERNAME || undefined,
    password: env.TERMIX_PASSWORD || undefined,
    totpCode: env.TERMIX_TOTP_CODE || undefined,
    insecureTls: env.TERMIX_INSECURE_TLS === "true",
    requestTimeoutMs: env.TERMIX_REQUEST_TIMEOUT_MS
      ? Number(env.TERMIX_REQUEST_TIMEOUT_MS)
      : undefined,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "config"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid Termix MCP configuration:\n${issues}`);
  }

  return parsed.data;
}

/** True when the config can perform encrypted-data operations (JWT login). */
export function canAccessEncryptedData(config: TermixConfig): boolean {
  return Boolean(config.username && config.password);
}
