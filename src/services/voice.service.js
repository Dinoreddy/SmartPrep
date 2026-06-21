import Groq, { toFile } from "groq-sdk";
import { createClient } from "@deepgram/sdk";
import { LiveInterview } from "../models/liveInterview.model.js";
import { AI_MODELS } from "../constants.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

/**
 * Tracks which interviewIds are currently mid-pipeline.
 * Prevents a second audio chunk from launching a concurrent pipeline
 * on the same interview, which would cause a transcript race condition
 * (both pipelines read the same DB state → last save wins → one turn lost).
 */
const activePipelines = new Set();

/**
 * Converts a Deepgram response ReadableStream into a Node.js Buffer.
 * @param {ReadableStream} stream
 * @returns {Promise<Buffer>}
 */
export async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Runs a single sentence through the Deepgram TTS API and emits
 * the resulting audio buffer + text back to the client socket.
 *
 * @param {string} sentence - The sentence to synthesize.
 * @param {import("socket.io").Socket|null} socket - Socket to emit to (can be null if we just want to return the buffer)
 * @returns {Promise<Buffer|null>} The synthesized audio buffer, or null on error
 */
export async function synthesizeAndEmit(sentence, socket = null) {
  const trimmed = sentence.trim();
  if (!trimmed) return;

  console.log(
    `[TTS] Synthesising sentence (${trimmed.length} chars): "${trimmed.slice(0, 60)}${trimmed.length > 60 ? "…" : ""}"`,
  );

  try {
    const ttsStart = Date.now();
    const response = await deepgram.speak.request(
      { text: trimmed },
      { model: AI_MODELS.TTS_AURA, encoding: "linear16", sample_rate: 16000 },
    );

    const stream = await response.getStream();
    if (!stream) {
      console.error("[TTS] Deepgram returned no stream for sentence:", trimmed);
      return;
    }

    const audioBuffer = await streamToBuffer(stream);
    console.log(
      `[TTS] OK — ${audioBuffer.byteLength} bytes in ${Date.now() - ttsStart}ms`,
    );

    if (socket) {
      socket.emit("ai_audio_chunk", {
        audio: audioBuffer,
        text: trimmed,
      });
    }

    return audioBuffer;
  } catch (err) {
    console.error("[TTS] Failed to synthesize sentence:", trimmed, err);
    return null;
  }
}

/**
 * Core STT → LLM → TTS pipeline.
 *
 * @param {string} interviewId - MongoDB ObjectId string of the LiveInterview doc.
 * @param {Buffer} audioBuffer - Raw audio bytes received from the client.
 * @param {import("socket.io").Socket} socket
 */
async function processAudioStream(interviewId, audioBuffer, socket) {
  // ── Concurrency guard ────────────────────────────────────────────────────
  // If a pipeline for this interview is already running, drop this chunk and
  // let the client know. This prevents two concurrent pipelines from reading
  // the same transcript state and then overwriting each other on save.
  if (activePipelines.has(interviewId)) {
    console.warn(
      `[Pipeline] BUSY — interviewId ${interviewId} already has an active pipeline. Dropping chunk.`,
    );
    socket.emit("pipeline_busy", {
      message:
        "Still processing your previous response. Please wait a moment before speaking again.",
    });
    return;
  }

  activePipelines.add(interviewId);
  const pipelineStart = Date.now();
  console.log(
    `[Pipeline] ── START ── interviewId: ${interviewId}, audio: ${audioBuffer.byteLength} bytes`,
  );

  try {
    // ── 1. STT: Whisper Turbo ────────────────────────────────────────────────
    console.log(
      `[Pipeline] Step 1 — STT: sending audio to Whisper-large-v3-turbo…`,
    );
    const sttStart = Date.now();
    const file = await toFile(audioBuffer, "audio.webm");

    const transcription = await groq.audio.transcriptions.create({
      file,
      model: AI_MODELS.STT_WHISPER,
    });

    const userText = transcription.text?.trim();
    if (!userText) {
      console.warn(
        "[Pipeline] Step 1 WARN — Empty transcription, skipping pipeline.",
      );
      return; // finally block will release the lock
    }
    console.log(
      `[Pipeline] Step 1 OK — STT done in ${Date.now() - sttStart}ms: "${userText.slice(0, 80)}${userText.length > 80 ? "…" : ""}"`,
    );

    // ── 2. Emit transcript update (user turn) ────────────────────────────────
    console.log(
      `[Pipeline] Step 2 — Emitting transcript_update (role: user) to client…`,
    );
    socket.emit("transcript_update", { role: "user", content: userText });
    console.log(`[Pipeline] Step 2 OK — transcript_update emitted.`);

    // ── 3. State management: fetch + append user message ────────────────────
    console.log(
      `[Pipeline] Step 3 — Fetching LiveInterview (${interviewId}) from DB…`,
    );
    const dbFetchStart = Date.now();
    const interview = await LiveInterview.findById(interviewId);
    if (!interview) {
      console.error(
        `[Pipeline] Step 3 FAILED — LiveInterview not found: ${interviewId}`,
      );
      return; // finally block will release the lock
    }
    console.log(
      `[Pipeline] Step 3 OK — Fetched in ${Date.now() - dbFetchStart}ms, transcript length: ${interview.transcript.length} messages.`,
    );

    interview.transcript.push({ role: "user", content: userText });

    // Step 3b: Save user turn immediately so it's not lost if pipeline crashes later
    await interview.save();
    console.log(
      `[Pipeline] Step 3 — Appended user turn and saved to DB. New transcript length: ${interview.transcript.length}.`,
    );

    // ── 4. LLM streaming (Llama 3.3 70B) ────────────────────────────────────
    console.log(
      `[Pipeline] Step 4 — LLM: opening stream to llama-3.3-70b-versatile (${interview.transcript.length} messages in context)…`,
    );
    const llmStart = Date.now();

    // Add an AbortController for a 30s timeout protection against stalled streams
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.error(`[Pipeline] LLM stream timed out after 30s! Aborting...`);
      controller.abort();
    }, 30000);

    const llmStream = await groq.chat.completions.create(
      {
        model: AI_MODELS.LLM_HEAVY,
        messages: interview.transcript.map(({ role, content }) => ({
          role,
          content,
        })),
        stream: true,
      },
      { signal: controller.signal },
    );

    console.log(
      `[Pipeline] Step 4 — LLM stream opened in ${Date.now() - llmStart}ms. Consuming chunks…`,
    );

    // ── 5. Sentence buffering + TTS loop ────────────────────────────────────
    let currentSentence = "";
    let fullResponse = "";
    let sentenceCount = 0;
    let tokenCount = 0;

    for await (const chunk of llmStream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (!delta) continue;

      tokenCount++;
      currentSentence += delta;
      fullResponse += delta;

      // Flush complete sentences to TTS as soon as they're ready
      // Match on ". ", "? ", "! " or at the end of string
      const sentenceEndRegex = /[.?!](\s|$)/;
      let matchIndex;

      while ((matchIndex = currentSentence.search(sentenceEndRegex)) !== -1) {
        // Wait... the match could be punctuation + space, or just punctuation + end of string.
        // Let's find the exact length of the match
        const matchStr = currentSentence.match(sentenceEndRegex)[0];

        // Include the punctuation and trailing space (if any)
        const completeSentence = currentSentence.slice(
          0,
          matchIndex + matchStr.length,
        );
        currentSentence = currentSentence.slice(matchIndex + matchStr.length); // skip punct + space

        // Only process if there's actual text
        if (completeSentence.trim()) {
          sentenceCount++;
          console.log(
            `[Pipeline] Step 5 — Sentence #${sentenceCount} flushed to TTS (${completeSentence.length} chars): "${completeSentence.slice(0, 55)}…"`,
          );

          // AWAIT this sequentially so audio chunks arrive at the client strictly in order
          await synthesizeAndEmit(completeSentence, socket);
        }
      }
    }

    // Clear the timeout since the stream finished naturally
    clearTimeout(timeoutId);

    // Flush any trailing text that didn't end with punctuation
    if (currentSentence.trim()) {
      sentenceCount++;
      console.log(
        `[Pipeline] Step 5 — Trailing sentence #${sentenceCount} flushed to TTS (${currentSentence.trim().length} chars).`,
      );
      await synthesizeAndEmit(currentSentence, socket);
    }

    console.log(
      `[Pipeline] Step 4/5 OK — LLM and TTS finished. Tokens: ~${tokenCount}, sentences: ${sentenceCount}, response: ${fullResponse.length} chars.`,
    );

    // ── 6. Commit complete AI response to MongoDB ────────────────────────────
    console.log(`[Pipeline] Step 6 — Saving AI response to MongoDB…`);
    const saveStart = Date.now();
    interview.transcript.push({ role: "assistant", content: fullResponse });
    await interview.save();
    console.log(
      `[Pipeline] Step 6 OK — Saved in ${Date.now() - saveStart}ms. Total transcript length: ${interview.transcript.length}.`,
    );

    // Let the client know the AI has finished its turn
    socket.emit("ai_turn_complete");
    console.log(
      `[Pipeline] ── DONE ── Total pipeline time: ${Date.now() - pipelineStart}ms ──`,
    );
  } catch (err) {
    console.error(
      `[Pipeline] UNHANDLED ERROR for interviewId ${interviewId}:`,
      err,
    );
    socket.emit("error", {
      message: "An unexpected error occurred during the interview pipeline.",
    });
  } finally {
    activePipelines.delete(interviewId);
    console.log(`[Pipeline] Lock released for interviewId: ${interviewId}`);
  }
}

export const voiceService = {
  processAudioStream,
  streamToBuffer,
  synthesizeAndEmit,
};
