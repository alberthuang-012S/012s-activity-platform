import { describe, expect, it } from "vitest";
import { getRuntimeConfig } from "./environment";

describe("runtime environment", () => {
  it("enables development APIs only in development", () => {
    expect(getRuntimeConfig({ APP_ENV: "development" }).devAdminEnabled).toBe(true);
    expect(
      getRuntimeConfig({ APP_ENV: "development", DEV_ADMIN_ENABLED: "false" }).devAdminEnabled
    ).toBe(false);
    expect(
      getRuntimeConfig({ APP_ENV: "production", DEV_ADMIN_ENABLED: "true" }).devAdminEnabled
    ).toBe(false);
  });

  it("parses a configured CORS allowlist without allowing wildcard", () => {
    const config = getRuntimeConfig({
      APP_ENV: "production",
      CORS_ALLOWED_ORIGINS: "https://example.com, https://example.com"
    });
    expect(config.corsAllowedOrigins).toEqual(["https://example.com"]);
    expect(config.corsAllowedOrigins).not.toContain("*");
  });
});
