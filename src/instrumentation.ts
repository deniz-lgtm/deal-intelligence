export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initSchema } = await import("@/lib/db");
    await initSchema();
    console.log("Database schema initialized");
    const key = process.env.ANTHROPIC_API_KEY;
    console.log("ANTHROPIC_API_KEY present:", !!key, "starts with:", key?.slice(0, 14));
  }
}
