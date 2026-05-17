export async function register() {
  // Only runs in the Node.js runtime (not Edge), once on server startup
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initCronScheduler } = await import("./lib/cron/scheduler");
    initCronScheduler();
  }
}
