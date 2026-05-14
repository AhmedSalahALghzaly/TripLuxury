import { Router, type Request, type Response } from "express";
import { clog } from "../lib/console-shim";
import OpenAI, { toFile } from "openai";
import { requireAuth, getCurrentUser } from "../server-auth";
import { query } from "../server-db";

function getOpenAiClient(): OpenAI {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL =
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
  if (!apiKey) throw new Error("OpenAI API key not configured");
  return new OpenAI({ apiKey, baseURL });
}

export function createAiRouter(): Router {
  const router = Router();

  // ─── POST /api/ai/tts ──────────────────────────────────────────────────────
  // Convert text to AI-powered speech using gpt-audio-mini.
  // Returns: { audio_base64: string, content_type: "audio/mp3" }
  router.post(
    "/ai/tts",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const { text, voice = "alloy" } = req.body as {
          text?: string;
          voice?: string;
        };
        if (!text?.trim()) {
          return res.status(400).json({ detail: "text is required" });
        }

        const openai = getOpenAiClient();

        const response = await (openai.chat.completions.create as any)({
          model: "gpt-audio-mini",
          modalities: ["text", "audio"],
          audio: { voice, format: "mp3" },
          messages: [
            {
              role: "system",
              content:
                "You are a professional text-to-speech assistant. Read the user's text exactly as provided in a natural, warm, and clear voice. Do not add any extra words.",
            },
            { role: "user", content: text.slice(0, 600) },
          ],
        });

        const audioData =
          (response.choices[0]?.message as any)?.audio?.data ?? "";
        if (!audioData) {
          clog.error("[TTS] No audio data returned from gpt-audio-mini");
          return res.status(500).json({ detail: "No audio data returned" });
        }

        return res.json({ audio_base64: audioData, content_type: "audio/mp3" });
      } catch (err: any) {
        clog.error("[TTS] Error:", err.message ?? err);
        return res.status(500).json({ detail: err.message ?? "TTS failed" });
      }
    },
  );

  // ─── POST /api/ai/suggest-replies ──────────────────────────────────────────
  // Generate 3 professional AI-suggested quick replies for an admin responding
  // to a customer in a direct chat conversation.
  // Body: { conversation_id: string }
  // Returns: { suggestions: string[] }
  router.post(
    "/ai/suggest-replies",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = await getCurrentUser(req);
        if (!user) return res.status(401).json({ detail: "Unauthorized" });

        const { conversation_id } = req.body as { conversation_id?: string };
        if (!conversation_id) {
          return res.status(400).json({ detail: "conversation_id is required" });
        }

        // Get the last 10 messages from the conversation
        const msgRes = await query(
          `SELECT sender_type, content, message_type, created_at
           FROM messages
           WHERE conversation_id = $1
             AND deleted_at IS NULL
             AND content IS NOT NULL AND content != ''
             AND message_type = 'text'
           ORDER BY created_at DESC LIMIT 10`,
          [conversation_id],
        );

        const recentMessages = msgRes.rows
          .reverse()
          .map(
            (m: any) =>
              `${m.sender_type === "customer" ? "العميل" : "الدعم"}: ${m.content}`,
          )
          .join("\n");

        if (!recentMessages.trim()) {
          return res.json({
            suggestions: [
              "مرحباً! كيف يمكنني مساعدتك؟",
              "أهلاً وسهلاً، نحن هنا لخدمتك",
              "شكراً لتواصلك معنا",
            ],
          });
        }

        const openai = getOpenAiClient();

        const response = await openai.chat.completions.create({
          model: "gpt-5.2",
          max_completion_tokens: 256,
          messages: [
            {
              role: "system",
              content: `أنت كونسيرج مضيف فاخر في مطعم الغزالي للمأكولات الفاخرة بالقاهرة.
مهمتك: اقترح 3 ردود قصيرة وراقية يمكن للمضيف إرسالها للضيف (اقتراح طبق، اقتراح مشروب مرافق، تأكيد طلب، شكر، إلخ).
القواعد:
- كل رد بحد أقصى 60 حرف عربي
- ودود وراقٍ ومباشر بأسلوب ضيافة فندقية
- متناسب مع سياق المحادثة
- أرجع JSON فقط: {"suggestions": ["رد1", "رد2", "رد3"]}`,
            },
            {
              role: "user",
              content: `المحادثة الأخيرة:\n${recentMessages}`,
            },
          ],
        });

        const content = response.choices[0]?.message?.content ?? "";
        let suggestions: string[] = [];

        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            suggestions = Array.isArray(parsed.suggestions)
              ? parsed.suggestions.slice(0, 3).filter((s: any) => typeof s === "string")
              : [];
          }
        } catch {
          // Extract lines as fallback
          suggestions = content
            .split("\n")
            .map((l) => l.replace(/^[-\d."]+\s*/, "").trim())
            .filter((l) => l.length > 0 && l.length <= 80)
            .slice(0, 3);
        }

        if (suggestions.length === 0) {
          suggestions = [
            "شكراً لتواصلك معنا!",
            "سنتابع موضوعك فوراً",
            "هل تحتاج مساعدة أخرى؟",
          ];
        }

        return res.json({ suggestions });
      } catch (err: any) {
        clog.error("[SuggestReplies] Error:", err.message ?? err);
        return res.status(500).json({ detail: err.message ?? "Failed" });
      }
    },
  );

  // ─── POST /api/ai/transcribe ────────────────────────────────────────────────
  // Transcribe audio to text using gpt-4o-mini-transcribe (faster + more accurate
  // than whisper-1 for Arabic).
  // Body: { audio_base64: string, content_type: string }
  // Returns: { transcript: string }
  router.post(
    "/ai/transcribe",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const { audio_base64, content_type } = req.body as {
          audio_base64?: string;
          content_type?: string;
        };
        if (!audio_base64) {
          return res.status(400).json({ detail: "audio_base64 is required" });
        }

        const mimeType = content_type || "audio/m4a";
        const ext = mimeType.includes("m4a")
          ? "m4a"
          : mimeType.includes("webm")
            ? "webm"
            : mimeType.includes("ogg")
              ? "ogg"
              : "mp3";

        const audioBuffer = Buffer.from(audio_base64, "base64");
        const openai = getOpenAiClient();

        const audioFile = await toFile(audioBuffer, `recording.${ext}`, {
          type: mimeType,
        });

        const transcription = await openai.audio.transcriptions.create({
          file: audioFile,
          model: "gpt-4o-mini-transcribe",
          response_format: "json",
        });

        const transcript = (transcription as any).text?.trim() ?? "";
        clog.log(
          "[Transcribe] gpt-4o-mini-transcribe result length:",
          transcript.length,
        );
        return res.json({ transcript });
      } catch (err: any) {
        clog.error("[Transcribe] gpt-4o-mini-transcribe error:", err.message ?? err);
        return res
          .status(500)
          .json({ detail: err.message ?? "Transcription failed" });
      }
    },
  );

  return router;
}
