export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initSchema } = await import("@/lib/db");
    await initSchema();
    console.log("Database schema initialized");
    console.log("ANTHROPIC_API_KEY present:", !!process.env.ANTHROPIC_API_KEY);
  }
}
