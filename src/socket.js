import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { voiceService } from "./services/voice.service.js";

/**
 * Initializes Socket.io on the raw Node HTTP server.
 *
 * @param {import("http").Server} server - The raw Node.js HTTP server.
 * @returns {import("socket.io").Server} The Socket.io server instance.
 */
export function initializeSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: "*",
    },
  });

  // ── JWT Authentication Middleware ─────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

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
    socket.on("join_interview", (interviewId) => {
      if (!interviewId || typeof interviewId !== "string") {
        socket.emit("error", { message: "Invalid interviewId" });
        return;
      }

      socket.join(interviewId);
      console.log(
        `[Socket.io] ${socket.id} joined interview room: ${interviewId}`,
      );
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

        await voiceService.processAudioStream(interviewId, buffer, socket);
      } catch (err) {
        console.error("[Socket.io] Error processing audio chunk:", err);
        socket.emit("error", {
          message: "Failed to process audio. Please try again.",
        });
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`[Socket.io] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  return io;
}
