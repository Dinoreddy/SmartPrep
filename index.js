import "dotenv/config";
import http from "http";
import app from "./src/app.js";
import { connectDB } from "./src/db/index.js";
import { initializeSocket } from "./src/socket.js";
import { startCronJobs } from "./src/jobs/cronJobs.js";

const PORT = Number(process.env.PORT) || 3000;

// Wrap Express in a raw HTTP server so Socket.io can share the same port
const server = http.createServer(app);

// Attach Socket.io
initializeSocket(server);

connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Socket.io is ready on the same port`);
      startCronJobs();
    });
  })
  .catch((err) => {
    console.error("[Startup] DB connection failed:", err);
    process.exit(1);
  });
