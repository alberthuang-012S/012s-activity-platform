export type AppEnvironment = "development" | "staging" | "production";

export interface RuntimeConfig {
  environment: AppEnvironment;
  firebaseProjectId?: string;
  devAdminEnabled: boolean;
  functionsRegion: string;
  devSessionTtlMinutes: number;
  corsAllowedOrigins: string[];
}

const DEFAULT_DEV_CORS_ORIGINS = [
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:5001",
  "http://127.0.0.1:5001",
  "https://alberthuang-012s.github.io"
];

function parseEnvironment(value: string | undefined): AppEnvironment {
  if (value === "production") {
    return "production";
  }
  if (value === "staging") {
    return "staging";
  }
  return "development";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOrigins(value: string | undefined, appEnvironment: AppEnvironment): string[] {
  const configured = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (configured && configured.length > 0) {
    return [...new Set(configured)];
  }

  return appEnvironment === "development" ? DEFAULT_DEV_CORS_ORIGINS : [];
}

export function getRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env
): RuntimeConfig {
  const appEnvironment = parseEnvironment(environment.APP_ENV);
  const explicitlyDisabled = environment.DEV_ADMIN_ENABLED === "false";

  return {
    environment: appEnvironment,
    firebaseProjectId: environment.FIREBASE_PROJECT_ID?.trim() || undefined,
    devAdminEnabled: appEnvironment === "development" && !explicitlyDisabled,
    functionsRegion: environment.FUNCTIONS_REGION?.trim() || "asia-east1",
    devSessionTtlMinutes: parsePositiveInteger(environment.DEV_SESSION_TTL_MINUTES, 480),
    corsAllowedOrigins: parseOrigins(environment.CORS_ALLOWED_ORIGINS, appEnvironment)
  };
}
