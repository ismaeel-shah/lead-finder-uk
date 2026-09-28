import { z } from "zod";

// Server-side config. Parsed lazily so a missing key surfaces as a friendly
// dashboard message instead of crashing the app at import time.

const numberFromEnv = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? fallback : Number(v)))
    .pipe(z.number().finite());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const envSchema = z.object({
  DATABASE_URL: optionalString,
  COMPANIES_HOUSE_API_KEY: optionalString,
  SEARCH_PROVIDER: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : "serper"))
    .pipe(z.enum(["serper", "google_cse"])),
  SERPER_API_KEY: optionalString,
  GOOGLE_CSE_API_KEY: optionalString,
  GOOGLE_CSE_ID: optionalString,
  MATCH_THRESHOLD: numberFromEnv(0.85).pipe(z.number().min(0).max(1)),
  BATCH_SIZE: numberFromEnv(10).pipe(z.number().int().min(1).max(100)),
  MAX_OWNER_COMPANIES: numberFromEnv(10).pipe(z.number().int().min(1).max(50)),
  /** LinkedIn company page + director profile search: for found leads (default), all companies, or off. */
  LINKEDIN_SEARCH: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim().toLowerCase() : "found"))
    .pipe(z.enum(["found", "all", "off"])),
  /** Facebook page location check: strict (default), lenient, or off. */
  FACEBOOK_LOCATION_CHECK: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim().toLowerCase() : "strict"))
    .pipe(z.enum(["strict", "lenient", "off"])),
  APP_PASSWORD: optionalString,
  /** Encrypts API keys saved from the dashboard (min 16 characters). */
  APP_SECRET: optionalString,
});

export type AppConfig = z.infer<typeof envSchema>;

export interface ConfigStatus {
  config: AppConfig | null;
  problems: string[];
}

export function getConfigStatus(): ConfigStatus {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    return {
      config: null,
      problems: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    };
  }

  const config = parsed.data;
  const problems: string[] = [];
  if (!config.DATABASE_URL) {
    problems.push("DATABASE_URL is missing. Add your Postgres connection string to .env.");
  }
  if (!config.COMPANIES_HOUSE_API_KEY) {
    problems.push("Companies House API key is missing (COMPANIES_HOUSE_API_KEY).");
  }
  // Serper keys can also be added in the dashboard, so a missing SERPER_API_KEY
  // is checked against the database by the page, not here.
  if (
    config.SEARCH_PROVIDER === "google_cse" &&
    (!config.GOOGLE_CSE_API_KEY || !config.GOOGLE_CSE_ID)
  ) {
    problems.push("GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID are required when SEARCH_PROVIDER=google_cse.");
  }
  return { config, problems };
}

/** Returns config or throws a readable error; use inside API routes. */
export function getConfig(): AppConfig {
  const { config, problems } = getConfigStatus();
  if (!config || problems.length > 0) {
    throw new ConfigError(problems.join(" "));
  }
  return config;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
