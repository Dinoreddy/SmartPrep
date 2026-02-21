import Groq, { toFile } from "groq-sdk";
import { createClient } from "@deepgram/sdk";
import { LiveInterview } from "../models/liveInterview.model.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

/**
 * Converts a Deepgram response ReadableStream into a Node.js Buffer.
 * @param {ReadableStream} stream
 * @returns {Promise<Buffer>}
 */
async function streamToBuffer(stream) {
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
 * @param {import("socket.io").Socket} socket
 */
async function synthesizeAndEmit(sentence, socket) {
  const trimmed = sentence.trim();
  if (!trimmed) return;

  console.log(
    `[TTS] Synthesising sentence (${trimmed.length} chars): "${trimmed.slice(0, 60)}${trimmed.length > 60 ? "…" : ""}"`,
  );

  try {
    const ttsStart = Date.now();
    const response = await deepgram.speak.request(
      { text: trimmed },
      { model: "aura-asteria-en", encoding: "linear16", sample_rate: 16000 },
    );

    const stream = await response.getStream();
    if (!stream) {
      console.error("[TTS] Deepgram returned no stream for sentence:", trimmed);
      return;
    }

    const audioBuffer = await streamToBuffer(stream);
    console.log(
      `[TTS] OK — ${audioBuffer.byteLength} bytes in ${Date.now() - ttsStart}ms — emitting ai_audio_chunk`,
    );

    socket.emit("ai_audio_chunk", {
      audio: audioBuffer,
      text: trimmed,
    });
  } catch (err) {
    console.error("[TTS] Failed to synthesize sentence:", trimmed, err);
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
  const pipelineStart = Date.now();
  console.log(
    `[Pipeline] ── START ── interviewId: ${interviewId}, audio: ${audioBuffer.byteLength} bytes`,
  );

  // ── 1. STT: Whisper Turbo ────────────────────────────────────────────────
  console.log(
    `[Pipeline] Step 1 — STT: sending audio to Whisper-large-v3-turbo…`,
  );
  const sttStart = Date.now();
  const file = await toFile(audioBuffer, "audio.webm");

  const transcription = await groq.audio.transcriptions.create({
    file,
    model: "whisper-large-v3-turbo",
  });

  const userText = transcription.text?.trim();
  if (!userText) {
    console.warn(
      "[Pipeline] Step 1 WARN — Empty transcription, skipping pipeline.",
    );
    return;
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
    return;
  }
  console.log(
    `[Pipeline] Step 3 OK — Fetched in ${Date.now() - dbFetchStart}ms, transcript length: ${interview.transcript.length} messages.`,
  );

  interview.transcript.push({ role: "user", content: userText });
  console.log(
    `[Pipeline] Step 3 — Appended user turn. New transcript length: ${interview.transcript.length}.`,
  );

  // ── 4. LLM streaming (Llama 3.3 70B) ────────────────────────────────────
  console.log(
    `[Pipeline] Step 4 — LLM: opening stream to llama-3.3-70b-versatile (${interview.transcript.length} messages in context)…`,
  );
  const llmStart = Date.now();
  const llmStream = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: interview.transcript.map(({ role, content }) => ({
      role,
      content,
    })),
    stream: true,
  });
  console.log(
    `[Pipeline] Step 4 — LLM stream opened in ${Date.now() - llmStart}ms. Consuming chunks…`,
  );

  // ── 5. Sentence buffering + TTS loop ────────────────────────────────────
  let currentSentence = "";
  let fullResponse = "";
  const ttsPromises = [];
  let sentenceCount = 0;
  let tokenCount = 0;

  for await (const chunk of llmStream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (!delta) continue;

    tokenCount++;
    currentSentence += delta;
    fullResponse += delta;

    // Flush complete sentences to TTS as soon as they're ready
    // Match on ". ", "? ", "! " to avoid splitting on decimal numbers
    const sentenceEndRegex = /[.?!]\s/;
    let matchIndex;

    while ((matchIndex = currentSentence.search(sentenceEndRegex)) !== -1) {
      // Include the punctuation character itself
      const completeSentence = currentSentence.slice(0, matchIndex + 1);
      currentSentence = currentSentence.slice(matchIndex + 2); // skip punct + space

      sentenceCount++;
      console.log(
        `[Pipeline] Step 5 — Sentence #${sentenceCount} flushed to TTS (${completeSentence.length} chars): "${completeSentence.slice(0, 55)}…"`,
      );
      ttsPromises.push(synthesizeAndEmit(completeSentence, socket));
    }
  }

  // Flush any trailing text that didn't end with punctuation + space
  if (currentSentence.trim()) {
    sentenceCount++;
    console.log(
      `[Pipeline] Step 5 — Trailing sentence #${sentenceCount} flushed to TTS (${currentSentence.trim().length} chars).`,
    );
    ttsPromises.push(synthesizeAndEmit(currentSentence, socket));
  }

  console.log(
    `[Pipeline] Step 4/5 OK — LLM finished. Tokens: ~${tokenCount}, sentences: ${sentenceCount}, response: ${fullResponse.length} chars. Waiting for all TTS…`,
  );

  // Wait for ALL TTS synthesis to complete before committing + signalling done
  const ttsWaitStart = Date.now();
  await Promise.all(ttsPromises);
  console.log(
    `[Pipeline] Step 5 OK — All ${ttsPromises.length} TTS task(s) completed in ${Date.now() - ttsWaitStart}ms.`,
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
}

export const voiceService = { processAudioStream };
