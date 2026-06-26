import cron from "node-cron";
import { seedService } from "../services/seed.service.js";

// Prevent multiple cron jobs from overlapping if seeding takes a long time
let isSeeding = false;

export const startCronJobs = () => {
  console.log("⏰ Initializing Background Cron Jobs...");

  // For demonstration: run every 5 minutes
  // In production, you might change this to hourly: "0 * * * *"
  const runSeeder = async () => {
    if (isSeeding) {
      console.log("⏰ [Cron] Skipping seed run because previous run is still active.");
      return;
    }

    try {
      isSeeding = true;
      console.log("⏰ [Cron] Starting scheduled database seeding...");
      await seedService.run();
      console.log("⏰ [Cron] Database seeding finished.");
    } catch (error) {
      console.error("⏰ [Cron] Error during seeding:", error);
    } finally {
      isSeeding = false;
    }
  };

  // Run it immediately on boot
  runSeeder();

  // Then schedule it to run every 5 minutes
  // cron.schedule("*/5 * * * *", runSeeder);

  // Hourly scheduler for production
  cron.schedule("0 0 * * *", runSeeder);

  console.log("⏰ Background Cron Jobs started (Seeder configured for 0 * * * *)");
};
