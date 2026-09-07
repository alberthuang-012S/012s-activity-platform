import process from "node:process";

if (process.argv[2] !== "--all") {
  console.error("Refusing to clear Firestore emulator. Re-run with: node scripts/emulator-cleanup.mjs --all");
  process.exitCode = 1;
} else {
  const baseUrl = (
    process.env.FIRESTORE_EMULATOR_URL ?? "http://127.0.0.1:8080"
  ).replace(/\/+$/, "");
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-012s-activity-platform";
  const url = `${baseUrl}/emulator/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents`;

  try {
    const response = await fetch(url, {
      method: "DELETE",
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      throw new Error(`Firestore emulator cleanup failed with HTTP ${response.status}.`);
    }
    console.log(`Cleared local Firestore emulator data for ${projectId}.`);
  } catch (error) {
    console.error(`Firestore emulator cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
