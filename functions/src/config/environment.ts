export type AppEnvironment = "development" | "production";

export interface RuntimeConfig {
  environment: AppEnvironment;
  firebaseProjectId?: string;
  devAdminEnabled: boolean;
  functionsRegion: string;
}

function parseEnvironment(value: string | undefined): AppEnvironment {
  return value === "production" ? "production" : "development";
}

export function getRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env
): RuntimeConfig {
  const appEnvironment = parseEnvironment(environment.APP_ENV);
  const explicitlyDisabled = environment.DEV_ADMIN_ENABLED === "false";
  const explicitlyEnabled = environment.DEV_ADMIN_ENABLED === "true";

  return {
    environment: appEnvironment,
    firebaseProjectId: environment.FIREBASE_PROJECT_ID?.trim() || undefined,
    devAdminEnabled:
      explicitlyEnabled || (!explicitlyDisabled && appEnvironment === "development"),
    functionsRegion: environment.FUNCTIONS_REGION?.trim() || "asia-east1"
  };
}
