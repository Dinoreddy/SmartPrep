import express from "express";
import bodyParser from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import router from "./routes/index.js";
import { errorHandler } from "./utils/ApiError.js";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use(bodyParser.json({ limit: "50mb" }));
app.use(
  bodyParser.urlencoded({
    limit: "50mb",
    extended: true,
    parameterLimit: 50000,
  })
);

// Parse cookies (needed for JWT auth via cookies)
app.use(cookieParser());

app.use("/api/v1", router);

// Health check
app.get("/api/v1", (req, res) => {
  res.status(200).json({ message: "API is running" });
});

app.use(errorHandler);

export default app;