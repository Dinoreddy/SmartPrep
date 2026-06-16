import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { voiceService } from "./services/voice.service.js";
import { LiveInterview } from "./models/liveInterview.model.js";

/**
 * Initializes Socket.io on the raw Node HTTP server.
 *
 * @param {import("http").Server} server - The raw Node.js HTTP server.
 * @returns {import("socket.io").Server} The Socket.io server instance.
 */
export function initializeSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
    },
  });

  // ── JWT Authentication Middleware ─────────────────────────────────────────
  io.use((socket, next) => {
    // 1. Try to get token from handshake auth (fallback for manual testing)
    let token = socket.handshake.auth?.token;

    // 2. If no token in auth, parse it from the HTTP-only cookies
    if (!token && socket.handshake.headers.cookie) {
      const cookies = socket.handshake.headers.cookie
        .split(";")
        .reduce((acc, cookieStr) => {
          const [key, value] = cookieStr.trim().split("=");
          acc[key] = value;
          return acc;
        }, {});
      token = cookies.accessToken;
    }

    if (!token) {
      return next(new Error("Authentication error: token missing"));
    }

    try {
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error("Authentication error: invalid or expired token"));
    }
  });

  // ── Connection Handler ────────────────────────────────────────────────────
  io.on("connection", (socket) => {
    console.log(
      `[Socket.io] Client connected: ${socket.id} (user: ${socket.user?._id})`,
    );

    // ── join_interview ────────────────────────────────────────────────────
    // Client sends interviewId to subscribe to a specific interview room
    socket.on("join_interview", async (interviewId) => {
      if (!interviewId || typeof interviewId !== "string") {
        socket.emit("error", { message: "Invalid interviewId" });
        return;
      }

      try {
        const interview = await LiveInterview.findById(interviewId);
        if (!interview) {
          socket.emit("error", { message: "Interview not found" });
          return;
        }

        if (interview.user.toString() !== socket.user._id.toString()) {
          console.warn(
            `[Socket.io] Auth warning: User ${socket.user._id} attempted to join interview ${interviewId} belonging to ${interview.user}`,
          );
          socket.emit("error", {
            message: "Unauthorized to join this interview",
          });
          return;
        }

        socket.join(interviewId);
        console.log(
          `[Socket.io] ${socket.id} joined interview room: ${interviewId}`,
        );
      } catch (err) {
        console.error("[Socket.io] Error joining interview:", err);
        socket.emit("error", { message: "Failed to join interview" });
      }
    });

    // ── candidate_audio_chunk ─────────────────────────────────────────────
    // Client sends a raw audio buffer for processing
    socket.on("candidate_audio_chunk", async ({ interviewId, audioBuffer }) => {
      if (!interviewId || !audioBuffer) {
        socket.emit("error", {
          message: "Missing interviewId or audioBuffer",
        });
        return;
      }

      try {
        // Convert to Buffer if the client sends an ArrayBuffer / Uint8Array
        const buffer = Buffer.isBuffer(audioBuffer)
          ? audioBuffer
          : Buffer.from(audioBuffer);

        // Security check: Guard against massive payloads
        if (buffer.byteLength > 10 * 1024 * 1024) {
          // 10MB limit
          console.warn(
            `[Socket.io] Dropped suspicious audio chunk: ${buffer.byteLength} bytes`,
          );
          socket.emit("error", { message: "Audio chunk too large (max 10MB)" });
          return;
        }

        // Security check: Validate interview ownership before pipeline
        const interview = await LiveInterview.findById(interviewId);
        if (
          !interview ||
          interview.user.toString() !== socket.user._id.toString()
        ) {
          socket.emit("error", {
            message: "Unauthorized to send audio to this interview",
          });
          return;
        }

        await voiceService.processAudioStream(interviewId, buffer, socket);
      } catch (err) {
        console.error("[Socket.io] Error processing audio chunk:", err);
        socket.emit("error", {
          message: "Failed to process audio. Please try again.",
        });
      }
    });

    // ── end_interview ───────────────────────────────────────────────────
    socket.on("end_interview", async (interviewId) => {
      if (!interviewId) return;

      try {
        const interview = await LiveInterview.findById(interviewId);
        if (
          !interview ||
          interview.user.toString() !== socket.user._id.toString()
        ) {
          socket.emit("error", {
            message: "Unauthorized to end this interview",
          });
          return;
        }

        interview.status = "COMPLETED";
        interview.completedAt = new Date();
        await interview.save();

        console.log(
          `[Socket.io] Interview ${interviewId} marked as COMPLETED by client`,
        );
        socket.emit("interview_ended", {
          interviewId,
          message: "Interview wrapped up successfully",
        });
      } catch (err) {
        console.error("[Socket.io] Error ending interview:", err);
        socket.emit("error", { message: "Failed to end interview" });
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`[Socket.io] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  return io;
}
