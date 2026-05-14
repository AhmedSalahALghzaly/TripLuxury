import { Router, type Request, type Response } from "express";
import { clog } from "../lib/console-shim";
import { randomUUID } from "node:crypto";
import { query } from "../server-db";
import { getCurrentUser, getUserRole, requireAuth } from "../server-auth";
import { ObjectStorageService } from "../lib/objectStorage";
import OpenAI, { toFile } from "openai";

function getOpenAiClient(): OpenAI {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL =
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
  if (!apiKey) throw new Error("OpenAI API key not configured");
  return new OpenAI({ apiKey, baseURL });
}
function genId() {
  return randomUUID();
}

export async function initChatTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      agent_id UUID,
      type VARCHAR(20) NOT NULL DEFAULT 'direct_chat',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      ai_auto_reply BOOLEAN NOT NULL DEFAULT true,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_auto_reply BOOLEAN NOT NULL DEFAULT true`,
  );

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id UUID NOT NULL,
      sender_type VARCHAR(20) NOT NULL DEFAULT 'customer',
      content TEXT,
      message_type VARCHAR(20) NOT NULL DEFAULT 'text',
      file_url TEXT,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      ai_auto_reply_sent BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Add ai_auto_reply_sent to existing tables (idempotent)
  await query(
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_auto_reply_sent BOOLEAN NOT NULL DEFAULT FALSE`,
  );
  // Location-message columns (idempotent). Stored as numeric so future
  // features (distance, geofencing) can index on them; address is a
  // best-effort reverse-geocoded label and may be NULL.
  await query(
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7)`,
  );
  await query(
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7)`,
  );
  await query(
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS address TEXT`,
  );

  await query(`
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(20) NOT NULL,
      title VARCHAR(500),
      content TEXT,
      file_url TEXT,
      metadata JSONB DEFAULT '{}',
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS ai_training_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      knowledge_id UUID REFERENCES knowledge_base(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      result JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(
    `CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_knowledge_base_type ON knowledge_base(type)`,
  );

  // Conversation groups (for privileged users to organize customer chats)
  await query(`
    CREATE TABLE IF NOT EXISTS conversation_groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      color VARCHAR(20) NOT NULL DEFAULT '#7C3AED',
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS conversation_group_members (
      group_id UUID NOT NULL REFERENCES conversation_groups(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, conversation_id)
    )
  `);

  clog.log("[Chat] Tables initialized");
}

async function searchKnowledgeBase(queryText: string, limit = 6) {
  const words = queryText
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 6);

  // Always include QA entries that match title (question) — highest priority
  const qaConditions = words.length
    ? words.map(
        (_, i) =>
          `(title ILIKE $${i + 1} OR metadata->>'question' ILIKE $${i + 1})`,
      )
    : ["1=1"];
  const contentConditions = words.length
    ? words.map((_, i) => `(content ILIKE $${i + 1} OR title ILIKE $${i + 1})`)
    : ["1=1"];
  const params = words.map((w) => `%${w}%`);

  // Priority 1: exact QA matches
  const qaRes = await query(
    `SELECT id, type, title, LEFT(content, 600) AS content, metadata
     FROM knowledge_base
     WHERE type = 'qa' AND (${qaConditions.join(" OR ")})
     ORDER BY created_at DESC LIMIT 3`,
    params.length ? params : [],
  );

  // Priority 2: other content matches
  const contentRes = await query(
    `SELECT id, type, title, LEFT(content, 600) AS content, metadata
     FROM knowledge_base
     WHERE type != 'qa' AND (${contentConditions.join(" OR ")})
     ORDER BY created_at DESC LIMIT ${limit - qaRes.rows.length}`,
    params.length ? params : [],
  );

  return [...qaRes.rows, ...contentRes.rows].slice(0, limit);
}

async function getAllQaChips(): Promise<
  Array<{
    id: string;
    question: string;
    answer: string;
    category: string | null;
  }>
> {
  const res = await query(
    `SELECT id, metadata->>'question' AS question, metadata->>'answer' AS answer, metadata->>'category' AS category
     FROM knowledge_base WHERE type = 'qa' AND metadata->>'question' IS NOT NULL
     ORDER BY created_at DESC LIMIT 20`,
  );
  return res.rows.filter((r: any) => r.question && r.answer);
}

const PRODUCT_KEYWORDS_AR = [
  "زيت",
  "فلتر",
  "بطارية",
  "مكبح",
  "فرامل",
  "دسكة",
  "حزام",
  "شمع",
  "بخاخ",
  "إطار",
  "عجل",
  "جنط",
  "محرك",
  "هواء",
  "كلتش",
  "أمورتيسير",
  "أمورتيزير",
  "ماء",
  "تبريد",
  "رادياتير",
  "شمعة",
  "بلوج",
  "بوجي",
  "بريك",
  "هيدروليك",
  "قطعة",
  "غيار",
  "سبير",
];
const PRODUCT_KEYWORDS_EN = [
  "oil",
  "filter",
  "battery",
  "brake",
  "disc",
  "belt",
  "spark",
  "injector",
  "tire",
  "wheel",
  "rim",
  "engine",
  "clutch",
  "shock",
  "absorber",
  "coolant",
  "radiator",
  "plug",
  "part",
  "spare",
];
// Keywords that signal the customer wants to reschedule or cancel an
// existing maintenance/installation appointment booking. Matched
// case-insensitively against the message body.
const APPOINTMENT_CHANGE_KEYWORDS = [
  "تعديل موعد",
  "إلغاء موعد",
  "الغاء موعد",
  "تغيير موعد",
  "أجل الموعد",
  "اجل الموعد",
  "ألغي موعد",
  "الغي موعد",
  "تعديل حجز",
  "إلغاء حجز",
  "الغاء حجز",
  "تغيير حجز",
  "موعد حجز",
  "reschedule",
  "cancel appointment",
  "cancel booking",
  "change appointment",
  "change booking",
];

async function fetchUpcomingAppointmentsContext(
  userId: string,
): Promise<string> {
  try {
    const res = await query(
      `SELECT id, appointment_date, service_type, status, car_info
         FROM appointments
        WHERE user_id = $1
          AND appointment_date >= NOW() - INTERVAL '1 day'
        ORDER BY appointment_date ASC
        LIMIT 5`,
      [userId],
    );
    if (!res.rows.length) return "لا توجد مواعيد قادمة";
    const tz = "Africa/Cairo";
    return res.rows
      .map((a: any) => {
        const d = new Date(a.appointment_date);
        const dateLabel = d.toLocaleDateString("ar-EG", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: tz,
        });
        const timeLabel = d.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: tz,
        });
        const service =
          a.service_type === "installation" ? "تركيب قطع" : "صيانة وفحص";
        return `موعد #${a.id} | ${service} | ${dateLabel} الساعة ${timeLabel} | الحالة: ${a.status}${a.car_info ? ` | ${a.car_info}` : ""}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

const ORDER_KEYWORDS = [
  "طلب",
  "أوردر",
  "اوردر",
  "شحن",
  "توصيل",
  "وصل",
  "حالة الطلب",
  "متى",
  "order",
  "delivery",
  "shipping",
  "track",
  "status",
  "when",
];
const STORE_KEYWORDS = [
  "عنوان",
  "موقع",
  "ساعات",
  "عمل",
  "تواصل",
  "تليفون",
  "هاتف",
  "واتس",
  "واتساب",
  "أين",
  "فين",
  "كيف أوصل",
  "address",
  "location",
  "hours",
  "contact",
  "phone",
  "whatsapp",
  "where",
  "how to reach",
];
const GREETING_KEYWORDS = [
  "مرحبا",
  "هلا",
  "أهلا",
  "السلام",
  "صباح",
  "مساء",
  "hi",
  "hello",
  "hey",
  "greetings",
];
const THANKS_KEYWORDS = [
  "شكرا",
  "شكراً",
  "متشكر",
  "thank",
  "thanks",
  "great",
  "perfect",
  "awesome",
];

function detectLanguage(msg: string): "ar" | "en" {
  const arabicPattern = /[\u0600-\u06FF]/;
  return arabicPattern.test(msg) ? "ar" : "en";
}

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

async function fetchProductContext(message: string): Promise<string> {
  try {
    const searchWords = message
      .replace(/[؟?!،,]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const terms = [...new Set(searchWords.slice(0, 6))];
    const conditions = terms.map(
      (_, i) =>
        `(name ILIKE $${i + 1} OR name_ar ILIKE $${i + 1} OR sku ILIKE $${i + 1} OR description ILIKE $${i + 1})`,
    );
    const params = terms.map((w) => `%${w}%`);
    const res = await query(
      `SELECT name, name_ar, price, sku, description FROM products
       WHERE deleted_at IS NULL AND (${conditions.join(" OR ")})
       ORDER BY created_at DESC LIMIT 5`,
      params,
    );
    if (!res.rows.length) {
      const fallback = await query(
        `SELECT name, name_ar, price, sku FROM products WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 3`,
      );
      return fallback.rows
        .map((p: any) => `${p.name_ar || p.name} — ${p.price} جنيه`)
        .join("\n");
    }
    return res.rows
      .map(
        (p: any) =>
          `${p.name_ar || p.name} | السعر: ${p.price} جنيه | كود: ${p.sku}${p.description ? ` | ${p.description.slice(0, 80)}` : ""}`,
      )
      .join("\n");
  } catch {
    return "";
  }
}

async function fetchOrderContext(userId: string): Promise<string> {
  try {
    const res = await query(
      `SELECT order_number, status, total_amount, created_at
       FROM orders WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 5`,
      [userId],
    );
    if (!res.rows.length) return "لا توجد طلبات";
    return res.rows
      .map((o: any) => {
        const date = new Date(o.created_at).toLocaleDateString("ar-EG");
        return `طلب #${o.order_number} | الحالة: ${o.status} | ${o.total_amount} جنيه | ${date}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

async function callOpenAiForResponse(
  systemPrompt: string,
  userMessage: string,
  history: ChatHistoryMessage[] = [],
): Promise<string | null> {
  try {
    const openai = getOpenAiClient();
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userMessage },
    ];
    const resp = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages,
    });
    const content = resp.choices[0]?.message?.content ?? null;
    if (content)
      clog.log("[OpenAI gpt-5.2] Response generated, length:", content.length);
    return content;
  } catch (e: any) {
    clog.error("[OpenAI gpt-5.2] error:", e?.message ?? e);
    return null;
  }
}

async function callOpenAiWithVision(
  systemPrompt: string,
  userMessage: string,
  imageUrl: string,
): Promise<string | null> {
  try {
    const openai = getOpenAiClient();
    const resp = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userMessage || "حلل هذه الصورة المرفقة وأخبرني بما تراه" },
            { type: "image_url", image_url: { url: imageUrl, detail: "auto" } },
          ],
        },
      ],
    });
    const content = resp.choices[0]?.message?.content ?? null;
    if (content) clog.log("[OpenAI Vision gpt-5.2] Response generated, length:", content.length);
    return content;
  } catch (e: any) {
    clog.error("[OpenAI Vision gpt-5.2] error:", e?.message ?? e);
    return null;
  }
}

async function fetchConversationHistory(
  conversationId: string,
  limit = 8,
): Promise<ChatHistoryMessage[]> {
  try {
    const res = await query(
      `SELECT sender_type, content FROM messages
       WHERE conversation_id = $1 AND content IS NOT NULL AND content != ''
         AND message_type = 'text'
       ORDER BY created_at DESC LIMIT $2`,
      [conversationId, limit],
    );
    return res.rows.reverse().map(
      (m: any): ChatHistoryMessage => ({
        role: m.sender_type === "customer" ? "user" : "assistant",
        content: m.content.slice(0, 300),
      }),
    );
  } catch {
    return [];
  }
}

async function fetchTextFileContent(fileUrl: string): Promise<string | null> {
  const TEXT_EXTENSIONS = [".txt", ".csv", ".json", ".xml", ".md", ".log", ".yaml", ".yml", ".html", ".htm"];
  try {
    const urlPath = new URL(fileUrl).pathname.toLowerCase();
    const hasTextExt = TEXT_EXTENSIONS.some((ext) => urlPath.endsWith(ext));
    if (!hasTextExt) return null;
    const resp = await fetch(fileUrl, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (text.includes("\0")) return null; // binary guard
    return text.slice(0, 3000);
  } catch {
    return null;
  }
}

function buildSystemPrompt(
  name: string,
  structuredCtx: string,
  options: { appointmentChangeIntent?: boolean } = {},
): string {
  const apptGuidance = options.appointmentChangeIntent
    ? `\n## تعامل خاص — طلب تعديل أو إلغاء موعد
العميل يطلب الآن تعديل أو إلغاء موعد حجز. اتبع هذا الأسلوب:
1. اشكر العميل بأسلوب احترافي ومريح، وأكّد له أن طلبه وصل وأن المختصين سيتواصلون معه قريباً.
2. إن لم يكن قد وضّح بعد ما إذا كان يريد **تعديل** الموعد أم **إلغاءه**، اسأله بسؤال واحد واضح وودود:
   "هل تفضّل تعديل الموعد لتاريخ آخر مناسب لك، أم إلغاءه نهائياً؟"
3. إذا أجاب أنه يريد التعديل: اشكره، أخبره أن الفريق سيتواصل معه قريباً لتأكيد الموعد الجديد، واطلب منه — إن أمكن — اقتراح تاريخ ووقت بديل ليُسهّل ذلك.
4. إذا أجاب أنه يريد الإلغاء: اشكره على إخطارنا، وأكّد له أنه سيتم إلغاء الموعد وأنه سيصله إشعار رسمي بالتأكيد قريباً.
5. إذا كان للعميل أكثر من موعد قادم في "بيانات النظام" أدناه، حدّد الموعد المعني بدقة في ردّك (التاريخ والوقت ونوع الخدمة).
6. لا تَعِد بأي تنفيذ فوري بنفسك — التعديل والإلغاء يتمّان عبر فريق المحل، وأنت فقط تنسّق وتطمئن العميل.\n`
    : "";

  return `أنت "كونسيرج الغزالي" — المضيف الذكي الرسمي والاحترافي لمطعم الغزالي للمأكولات الفاخرة بالقاهرة، مصر.
اسم الضيف: ${name || "الضيف الكريم"}
التاريخ: ${new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" })}

## مهمتك الأساسية
تقديم تجربة ضيافة استثنائية لضيوف المطعم: اقتراح الأطباق، شرح المكونات، اقتراح الإقتران المثالي بين الطعام والمشروبات، تقديم بدائل صحية أو نباتية، ومساعدة الضيف في إتمام طلبه. أجب دائماً بنفس لغة الضيف (عربي أو إنجليزي) بأسلوب راقٍ ودود.

## معايير الجودة في الرد
1. **الوضوح والإيجاز**: رد مركّز في حدود 200-250 كلمة — أسلوب راقٍ بلا تطويل.
2. **الدقة الطهوية**: استخدم مصطلحات الطهي الصحيحة (تقنيات الطهي، المكونات الأساسية، التتبيل، طريقة التقديم، درجة النضج، الحساسيات الغذائية).
3. **الإقتران المثالي**: عند ذكر طبق، اقترح المشروب أو الإضافة المناسبة (نبيذ غير كحولي، عصير طازج، شاي، قهوة مختصة) ووجبة كومبو إن وُجدت.
4. **التحليل الغذائي**: إن طلب الضيف، قدّم نبذة عن المكونات، السعرات الحرارية التقريبية، ومعلومات الحساسية (جلوتين، مكسرات، ألبان...) باعتدال وبدون ادعاء طبي.
5. **الصدق**: لا تخترع معلومات غير موجودة في "بيانات النظام" — قل "سأتحقق لك من الشيف مباشرة" إذا لم تعرف.
6. **الانتماء للتخصص**: إذا خرج السؤال عن عالم المطاعم والطعام والمشروبات والضيافة، أعد الضيف بلطف لتجربتنا.
7. **عروض قيّمة**: إذا ذكر الضيف طبقاً، اعرض البدائل والأسعار من القائمة المتوفرة في النظام.

## تنسيق إلزامي للاقتراحات الفاخرة (يحوّلها التطبيق إلى بطاقات مرئية)
التطبيق يحوّل تلقائياً أي سطر يبدأ بإحدى الكلمات المفتاحية أدناه إلى بطاقة فاخرة. يجب أن يكون كل سطر **مستقلاً على سطر منفصل** (لا داخل فقرة)، بدون نقاط أو شرطات في البداية، وبصيغة "الكلمة: القيمة" تماماً.

### عند اقتراح مشروب مرافق (نبيذ، نبيذ غير كحولي، عصير، شاي، قهوة، موكتيل):
أضف سطراً واحداً لكل اقتراح بهذا الشكل بالضبط:
- بالعربية: "اقتران: <اسم المشروب> — <ملاحظة تذوّق قصيرة>"
- بالإنجليزية: "Pairing: <drink name> — <short tasting note>"
- يمكن استبدال "Pairing" بـ "Wine" أو "Drink" أو "Pair with"، واستبدال "اقتران" بـ "مزاوجة" أو "يقترن مع" أو "مشروب" إن لزم.
- ملاحظة التذوّق اختيارية لكنها مستحسنة، وتُفصل بـ " — " (شرطة em محاطة بمسافتين).
- مثال: Pairing: Chardonnay Reserve — buttery oak with citrus finish
- مثال: اقتران: شاي الياسمين الأخضر — رائحة زهرية تنعش الحنك

### عند ذكر معلومات غذائية (سعرات، بروتين، كربوهيدرات، دهون، ألياف، صوديوم):
أضف سطراً مستقلاً لكل عنصر بالصيغ التالية (كل واحد على سطر منفصل):
- بالإنجليزية: "Calories: 540 kcal" ، "Protein: 28 g" ، "Carbs: 42 g" ، "Fat: 22 g" ، "Fiber: 6 g" ، "Sodium: 480 mg"
- بالعربية: "السعرات: 540 سعرة" ، "البروتين: 28 جم" ، "الكربوهيدرات: 42 جم" ، "الدهون: 22 جم" ، "الألياف: 6 جم" ، "الصوديوم: 480 ملجم"
- يجب أن يكون لكل قيمة سطر منفصل بصيغة "<التسمية>: <القيمة والوحدة>" بالضبط.

### قواعد عامة لهذه الأسطر
- ضعها في نهاية الرد (أو في فقرة منفصلة)، كل سطر على سطر مستقل.
- لا تضع نقاط ترقيم في بداية السطر، ولا تَلُف السطر بأي علامات تنسيق (لا نجمات، لا backticks، لا قائمة).
- إذا كان هناك عدّة اقتراحات إقتران، كرّر سطر "Pairing:" أو "اقتران:" لكل واحد على سطر منفصل.
- الأرقام الغذائية تقريبية — لا بأس باستخدام "~" قبل القيمة (مثل "Calories: ~540 kcal").

## معلومات المطعم
- **الاسم التجاري**: مطعم الغزالي للمأكولات الفاخرة (Al-Ghazaly Luxury Dining)
- **الموقع**: القاهرة، مصر
- **التخصص**: مأكولات عالمية فاخرة، أطباق من اختيار الشيف، وجبات عائلية، مشروبات مختصة، حلويات راقية، إضافات جانبية
- **الاتصال**: عبر التطبيق أو الرسائل المباشرة
- **ساعات الاستقبال**: يومياً من 12 ظهراً حتى منتصف الليل
${apptGuidance}${structuredCtx ? `\n## بيانات من النظام\n${structuredCtx}` : ""}`;
}

async function buildSmartResponse(
  message: string,
  userId: string,
  customerData: any,
  kbContext: string,
  conversationId?: string,
): Promise<string> {
  const lang = detectLanguage(message);
  const lower = message.toLowerCase();
  const name = customerData.name ? customerData.name.split(" ")[0] : "";

  const needsOrders = containsAny(lower, ORDER_KEYWORDS);
  const needsProducts = containsAny(lower, [
    ...PRODUCT_KEYWORDS_AR,
    ...PRODUCT_KEYWORDS_EN,
  ]);
  // Detect a reschedule/cancel intent. We also peek at the recent
  // conversation history below so we keep using this branch while the
  // customer is mid-conversation about it (e.g. their reply is just
  // "تعديل" or "إلغاء" without keywords).
  const needsAppointmentChange = containsAny(
    lower,
    APPOINTMENT_CHANGE_KEYWORDS,
  );

  const [orderCtx, productCtx, history] = await Promise.all([
    needsOrders ? fetchOrderContext(userId) : Promise.resolve(""),
    needsProducts ? fetchProductContext(message) : Promise.resolve(""),
    conversationId
      ? fetchConversationHistory(conversationId)
      : Promise.resolve([]),
  ]);

  // Stay in the appointment-change flow while the assistant has been
  // discussing it in any of the last few turns.
  const recentHistoryText = history
    .map((h) => h.content.toLowerCase())
    .join(" ");
  const inAppointmentFlow =
    needsAppointmentChange ||
    APPOINTMENT_CHANGE_KEYWORDS.some((k) => recentHistoryText.includes(k));

  const apptCtx = inAppointmentFlow
    ? await fetchUpcomingAppointmentsContext(userId)
    : "";

  const structuredCtx = [
    apptCtx ? `=== مواعيد العميل القادمة ===\n${apptCtx}` : "",
    orderCtx ? `=== طلبات العميل ===\n${orderCtx}` : "",
    productCtx ? `=== منتجات ذات صلة ===\n${productCtx}` : "",
    kbContext ? `=== قاعدة المعرفة ===\n${kbContext.slice(0, 600)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = buildSystemPrompt(name, structuredCtx, {
    appointmentChangeIntent: inAppointmentFlow,
  });
  const aiReply = await callOpenAiForResponse(systemPrompt, message, history);
  if (aiReply) return aiReply;

  // Fallback: rule-based responses when OpenAI is unavailable
  if (needsOrders && orderCtx && orderCtx !== "لا توجد طلبات") {
    return lang === "ar"
      ? `📦 آخر طلباتك:\n\n${orderCtx}\n\nهل تحتاج مساعدة أخرى؟`
      : `📦 Your recent orders:\n\n${orderCtx}\n\nIs there anything else I can help with?`;
  }
  if (needsOrders) {
    return lang === "ar"
      ? "لا يوجد لديك طلبات حتى الآن. ابدأ التسوق من قسم المنتجات! 🛒"
      : "You don't have any orders yet. Start shopping from the Products section! 🛒";
  }
  if (needsProducts && productCtx) {
    return lang === "ar"
      ? `🔍 وجدنا هذه المنتجات:\n\n${productCtx}\n\nيمكنك تصفح المزيد في قسم المنتجات 🛒`
      : `🔍 Found these products:\n\n${productCtx}\n\nBrowse more in the Products section 🛒`;
  }
  if (kbContext) {
    return lang === "ar"
      ? `📚 من قاعدة معلوماتنا:\n\n${kbContext.slice(0, 400)}\n\nهل تريد الاستفسار عن شيء آخر؟`
      : `📚 From our knowledge base:\n\n${kbContext.slice(0, 400)}\n\nAnything else?`;
  }

  // General fallback
  return lang === "ar"
    ? `أهلاً${name ? " " + name : ""}! 😊\nيمكنني مساعدتك في:\n\n• 🔍 البحث عن قطع الغيار\n• 📦 متابعة طلباتك\n• 📍 معلومات المحل\n\nكيف يمكنني مساعدتك؟`
    : `Hello${name ? " " + name : ""}! 😊\nI can help with:\n\n• 🔍 Auto parts search\n• 📦 Order tracking\n• 📍 Store info\n\nHow can I help you?`;
}

/**
 * doAutoReply — shared server-side AI auto-reply executor.
 *
 * Atomically claims the customer message via `ai_auto_reply_sent` flag so
 * only one reply is ever sent, regardless of how many callers race (multiple
 * connected admin clients + this server-side fallback trigger).
 *
 * Returns true if a reply was generated and broadcast, false if skipped.
 */
export async function doAutoReply(
  messageId: string,
  conversationId: string,
  broadcastToUser: (userId: string, msg: object) => void,
): Promise<boolean> {
  // Atomic claim: flip flag to TRUE only if still FALSE
  const claimResult = await query(
    `UPDATE messages
     SET ai_auto_reply_sent = TRUE
     WHERE id = $1
       AND conversation_id = $2
       AND sender_type = 'customer'
       AND ai_auto_reply_sent = FALSE
     RETURNING id, content, message_type, file_url`,
    [messageId, conversationId],
  );
  if (!claimResult.rows.length) return false; // Another caller already handled it

  const srcMsg = claimResult.rows[0];

  // Verify conversation still has AI auto-reply enabled in DB
  const convCheck = await query(
    `SELECT ai_auto_reply FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
    [conversationId],
  );
  if (!convCheck.rows.length || convCheck.rows[0].ai_auto_reply === false) return false;

  const convRes = await query(
    `SELECT c.user_id, u.name FROM conversations c
     JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
    [conversationId],
  );
  if (!convRes.rows.length) return false;

  const convOwner = convRes.rows[0];
  const name = convOwner.name ? convOwner.name.split(" ")[0] : "";
  const queryMessage = srcMsg.content || "اقترح رداً مناسباً";

  const [orderCtx, productCtx, kbResults] = await Promise.all([
    fetchOrderContext(convOwner.user_id),
    fetchProductContext(queryMessage),
    searchKnowledgeBase(queryMessage),
  ]);
  const kbContext = kbResults
    .map((r: any) => `[${r.type.toUpperCase()}] ${r.title || ""}: ${r.content}`)
    .join("\n\n");
  const structuredCtx = [
    orderCtx && orderCtx !== "لا توجد طلبات" ? `=== طلبات العميل ===\n${orderCtx}` : "",
    productCtx ? `=== منتجات ذات صلة ===\n${productCtx}` : "",
    kbContext ? `=== قاعدة المعرفة ===\n${kbContext.slice(0, 600)}` : "",
  ].filter(Boolean).join("\n\n");

  const systemPrompt = buildSystemPrompt(name, structuredCtx);
  let aiReply: string | null = null;

  if (srcMsg.file_url && srcMsg.message_type === "image") {
    const userMsg = srcMsg.content || "الرجاء تحليل هذه الصورة وإرشاد العميل";
    aiReply = await callOpenAiWithVision(systemPrompt, userMsg, srcMsg.file_url);
  } else if (srcMsg.file_url && srcMsg.message_type === "file") {
    const fileText = await fetchTextFileContent(srcMsg.file_url);
    const fileCtx = fileText
      ? (structuredCtx ? `${structuredCtx}\n\n=== محتوى الملف المرفق ===\n${fileText}` : `=== محتوى الملف المرفق ===\n${fileText}`)
      : structuredCtx;
    const filePrompt = buildSystemPrompt(name, fileCtx);
    aiReply = await callOpenAiForResponse(
      filePrompt,
      srcMsg.content || "العميل أرسل ملفاً، اقترح رداً مناسباً",
      [],
    );
  } else {
    aiReply = await buildSmartResponse(
      srcMsg.content,
      convOwner.user_id,
      { name: convOwner.name },
      kbContext,
      conversationId,
    );
  }

  if (!aiReply) return false;

  const aiMsgId = genId();
  const aiMsgResult = await query(
    `INSERT INTO messages (id, conversation_id, sender_id, sender_type, content, message_type)
     VALUES ($1, $2, $3, 'ai_agent', $4, 'text') RETURNING *`,
    [aiMsgId, conversationId, convOwner.user_id, aiReply],
  );
  await query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);

  const aiPayload = {
    type: "chat_message",
    message: aiMsgResult.rows[0],
    conversation_id: conversationId,
  };
  broadcastToUser(convOwner.user_id, aiPayload);
  const privilegedUsers = await query(
    `SELECT DISTINCT u.id FROM users u
     WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL)
        OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)`,
  );
  for (const pu of privilegedUsers.rows) {
    broadcastToUser(pu.id, aiPayload);
  }
  return true;
}

export function createChatRouter(
  broadcastToUser: (userId: string, msg: object) => void,
) {
  const router = Router();

  // ─── Conversations ────────────────────────────────────────────────────────

  router.get(
    "/chat/conversations",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);

        let result;
        if (role === "owner" || role === "admin") {
          result = await query(
            `SELECT c.*, u.name AS user_name, u.email AS user_email, u.picture AS user_picture,
               CASE
                 WHEN EXISTS(SELECT 1 FROM owners o WHERE o.email = u.email AND o.deleted_at IS NULL) THEN 'owner'
                 WHEN EXISTS(SELECT 1 FROM admins a WHERE a.email = u.email AND a.deleted_at IS NULL) THEN 'admin'
                 ELSE 'customer'
               END AS user_role,
               (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
               (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
               (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.is_read = FALSE AND m.sender_type = 'customer') AS unread_count
             FROM conversations c
             JOIN users u ON u.id = c.user_id
             WHERE c.deleted_at IS NULL AND c.status != 'deleted'
             ORDER BY (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = c.id) DESC NULLS LAST`,
          );
        } else {
          result = await query(
            `SELECT c.*,
               (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
               (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
             FROM conversations c
             WHERE c.user_id = $1 AND c.deleted_at IS NULL AND c.status != 'deleted'
             ORDER BY (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = c.id) DESC NULLS LAST`,
            [user.id],
          );
        }
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.get(
    "/chat/conversations/deleted",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (role !== "owner") {
          return res.status(403).json({ detail: "Owner only" });
        }
        const result = await query(
          `SELECT c.*, u.name AS user_name, u.email AS user_email, u.picture AS user_picture,
             (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
           FROM conversations c
           JOIN users u ON u.id = c.user_id
           WHERE c.deleted_at IS NOT NULL OR c.status = 'deleted'
           ORDER BY c.deleted_at DESC NULLS LAST`,
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.get(
    "/chat/conversations/unread-count",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (role !== "owner" && role !== "admin") {
          return res.json({ unread_count: 0 });
        }
        const result = await query(
          `SELECT COUNT(*) AS count
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE m.is_read = FALSE AND m.sender_type = 'customer' AND c.deleted_at IS NULL`,
        );
        return res.json({
          unread_count: parseInt(result.rows[0]?.count || "0"),
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.get(
    "/chat/conversations/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const { id } = req.params;

        const conv = await query(
          `SELECT c.*, u.name AS user_name, u.email AS user_email, u.picture AS user_picture
           FROM conversations c JOIN users u ON u.id = c.user_id
           WHERE c.id = $1 AND c.deleted_at IS NULL`,
          [id],
        );
        if (!conv.rows.length) {
          return res.status(404).json({ detail: "Conversation not found" });
        }
        const conversation = conv.rows[0];
        if (
          role !== "owner" &&
          role !== "admin" &&
          conversation.user_id !== user.id
        ) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        // Return conversation with its messages
        const msgResult = await query(
          `SELECT m.*, u.name AS sender_name, u.picture AS sender_picture
           FROM messages m
           LEFT JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = $1
           ORDER BY m.created_at ASC LIMIT 100`,
          [id],
        );
        return res.json({ conversation, messages: msgResult.rows });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.post(
    "/chat/conversations",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const { type = "direct_chat", user_id } = req.body;
        const role = await getUserRole(user.email);

        // Hardening: AI agent threads MUST belong to the authenticated caller.
        // Even privileged users cannot create an ai_agent conversation on
        // behalf of another user — that would let the floating AI panel
        // bind to someone else's history.
        const targetUserId =
          type === "ai_agent"
            ? user.id
            : role === "owner" || role === "admin"
              ? user_id || user.id
              : user.id;

        const existing = await query(
          `SELECT id FROM conversations WHERE user_id = $1 AND type = $2 AND deleted_at IS NULL AND status != 'deleted' LIMIT 1`,
          [targetUserId, type],
        );
        if (existing.rows.length) {
          return res.json({ conversation: existing.rows[0] });
        }

        const id = genId();
        const result = await query(
          `INSERT INTO conversations (id, user_id, type, status)
           VALUES ($1, $2, $3, 'active') RETURNING *`,
          [id, targetUserId, type],
        );
        return res.status(201).json({ conversation: result.rows[0] });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.patch(
    "/chat/conversations/:id/status",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (role !== "owner" && role !== "admin") {
          return res.status(403).json({ detail: "Admin/Owner only" });
        }
        const { id } = req.params;
        const { status } = req.body;

        if (status === "deleted") {
          await query(
            `UPDATE conversations SET status = 'deleted', deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [id],
          );
        } else {
          await query(
            `UPDATE conversations SET status = $1, updated_at = NOW() WHERE id = $2`,
            [status, id],
          );
        }
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.patch(
    "/chat/conversations/:id/restore",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (role !== "owner") {
          return res.status(403).json({ detail: "Owner only" });
        }
        const { id } = req.params;
        await query(
          `UPDATE conversations SET status = 'active', deleted_at = NULL, updated_at = NOW() WHERE id = $1`,
          [id],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ── Toggle AI auto-reply for a conversation ──────────────────────────────
  router.patch(
    "/chat/conversations/:id/ai-toggle",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (role !== "owner" && role !== "admin") {
          return res.status(403).json({ detail: "Admin/Owner only" });
        }
        const { id } = req.params;
        const { enabled } = req.body as { enabled: boolean };
        await query(
          `UPDATE conversations SET ai_auto_reply = $1, updated_at = NOW() WHERE id = $2`,
          [enabled, id],
        );
        return res.json({ success: true, ai_auto_reply: enabled });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Permanent-delete conversation (owner only).
  // Cleans up:
  //   1. Every media file attached to a message in this conversation
  //      (best-effort delete from object storage).
  //   2. All message rows (via ON DELETE CASCADE on messages.conversation_id).
  //   3. The conversation row itself.
  router.delete(
    "/chat/conversations/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (role !== "owner") {
          return res.status(403).json({ detail: "Owner only" });
        }
        const { id } = req.params;

        // 1. Collect every file_url referenced by messages in this
        //    conversation so we can purge object storage. We do this
        //    BEFORE the DB delete so the rows are still queryable.
        let mediaUrls: string[] = [];
        try {
          const mediaRes = await query(
            `SELECT file_url FROM messages
             WHERE conversation_id = $1 AND file_url IS NOT NULL AND file_url <> ''`,
            [id],
          );
          mediaUrls = mediaRes.rows
            .map((r: any) => r.file_url as string)
            .filter(Boolean);
        } catch (err: any) {
          clog.warn(
            "[chat] permanent-delete: failed to enumerate media urls",
            err?.message,
          );
        }

        // 2. Delete the conversation row — messages cascade by FK.
        await query(`DELETE FROM conversations WHERE id = $1`, [id]);

        // 3. Best-effort object storage cleanup. Errors here MUST NOT
        //    fail the request; the DB rows are already gone and we
        //    don't want the client to retry a successful delete.
        if (mediaUrls.length > 0) {
          const storage = new ObjectStorageService();
          await Promise.allSettled(
            mediaUrls.map((u) => storage.deleteObjectByUrl(u)),
          );
        }

        return res.json({
          success: true,
          deleted_media_count: mediaUrls.length,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ─── Messages ── ��──────────────────────────────────────────────────────────

  router.get(
    "/chat/messages/:conversationId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const { conversationId } = req.params;

        // Authorization: must own the conversation or be privileged.
        // Privileged users may also read messages from archived (deleted_at IS NOT NULL) conversations.
        const convCheck = await query(
          `SELECT user_id, deleted_at FROM conversations WHERE id = $1`,
          [conversationId],
        );
        if (!convCheck.rows.length) {
          return res.status(404).json({ detail: "Conversation not found" });
        }
        const isPrivileged = role === "owner" || role === "admin";
        const isArchived = !!convCheck.rows[0].deleted_at;
        // Non-privileged users cannot access archived conversations at all
        if (isArchived && !isPrivileged) {
          return res.status(404).json({ detail: "Conversation not found" });
        }
        if (!isPrivileged && convCheck.rows[0].user_id !== user.id) {
          return res.status(403).json({ detail: "Forbidden" });
        }

        const limit = parseInt((req.query.limit as string) || "50");
        const offset = parseInt((req.query.offset as string) || "0");

        const result = await query(
          `SELECT m.*,
             u.name AS sender_name, u.picture AS sender_picture
           FROM messages m
           LEFT JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = $1
           ORDER BY m.created_at ASC
           LIMIT $2 OFFSET $3`,
          [conversationId, limit, offset],
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.post(
    "/chat/messages",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const {
          conversation_id,
          content,
          message_type = "text",
          file_url,
          latitude,
          longitude,
          address,
        } = req.body;

        // Location messages don't need text/file_url, just numeric coords.
        const isLocationMsg = message_type === "location";
        const hasValidCoords =
          isLocationMsg &&
          typeof latitude === "number" &&
          typeof longitude === "number" &&
          isFinite(latitude) &&
          isFinite(longitude) &&
          latitude >= -90 &&
          latitude <= 90 &&
          longitude >= -180 &&
          longitude <= 180;

        if (!conversation_id || (!content && !file_url && !hasValidCoords)) {
          return res
            .status(400)
            .json({ detail: "conversation_id and content are required" });
        }

        if (isLocationMsg && !hasValidCoords) {
          return res
            .status(400)
            .json({ detail: "valid latitude and longitude are required for location messages" });
        }

        const role = await getUserRole(user.email);
        const isPrivileged = role === "owner" || role === "admin";

        const convResult = await query(
          `SELECT user_id FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
          [conversation_id],
        );
        if (!convResult.rows.length) {
          return res.status(404).json({ detail: "Conversation not found" });
        }

        // Authorization: only the conversation owner or privileged roles can post
        if (!isPrivileged && convResult.rows[0].user_id !== user.id) {
          return res.status(403).json({ detail: "Forbidden" });
        }

        let senderType = "customer";
        if (role === "owner") senderType = "owner";
        else if (role === "admin") senderType = "admin";

        const msgId = genId();
        const msgResult = await query(
          `INSERT INTO messages
             (id, conversation_id, sender_id, sender_type, content, message_type, file_url, latitude, longitude, address)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            msgId,
            conversation_id,
            user.id,
            senderType,
            content || null,
            message_type,
            file_url || null,
            isLocationMsg ? latitude : null,
            isLocationMsg ? longitude : null,
            isLocationMsg ? (typeof address === "string" ? address.slice(0, 500) : null) : null,
          ],
        );

        await query(
          `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
          [conversation_id],
        );

        const msg = msgResult.rows[0];
        const wsPayload = {
          type: "chat_message",
          message: msg,
          conversation_id,
        };

        // Always notify the conversation owner (customer)
        broadcastToUser(convResult.rows[0].user_id, wsPayload);

        // If sender is customer, also notify all admins/owners in real-time
        if (senderType === "customer") {
          const privilegedUsers = await query(
            `SELECT DISTINCT u.id FROM users u
             WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL)
                OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)`,
          );
          for (const pu of privilegedUsers.rows) {
            if (pu.id !== convResult.rows[0].user_id) {
              broadcastToUser(pu.id, wsPayload);
            }
          }

          // Server-side fallback: fires async so it never blocks the response.
          // Uses the same DB-level atomic claim (ai_auto_reply_sent) as the
          // client-side trigger — whichever fires first wins, all others skip.
          // This guarantees auto-reply fires even when no admin/owner is online.
          const msgIdForReply = msg.id;
          const convIdForReply = conversation_id;
          ;(async () => {
            // Brief delay to give WS-connected clients a first-mover chance.
            // If a client claims it in this window the server call will no-op.
            await new Promise((r) => setTimeout(r, 2500));
            try {
              await doAutoReply(msgIdForReply, convIdForReply, broadcastToUser);
            } catch (e) {
              clog.error("[AutoReply-Fallback] Error:", e);
            }
          })();
        }

        return res.status(201).json({ message: msg });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.patch(
    "/chat/messages/read/:conversationId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const { conversationId } = req.params;
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const isPrivileged = role === "owner" || role === "admin";

        // Authorization: must own the conversation or be privileged
        const convCheck = await query(
          `SELECT user_id FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
          [conversationId],
        );
        if (!convCheck.rows.length) {
          return res.status(404).json({ detail: "Conversation not found" });
        }
        if (!isPrivileged && convCheck.rows[0].user_id !== user.id) {
          return res.status(403).json({ detail: "Forbidden" });
        }

        // When a privileged user reads, mark customer messages as read.
        // When a customer reads, mark both admin AND owner messages as read.
        const markReadForTypes = isPrivileged
          ? ["customer"]
          : ["admin", "owner"];

        await query(
          `UPDATE messages SET is_read = TRUE, updated_at = NOW()
           WHERE conversation_id = $1 AND sender_type = ANY($2::text[]) AND is_read = FALSE`,
          [conversationId, markReadForTypes],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.delete(
    "/chat/messages/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (role !== "owner") {
          return res.status(403).json({ detail: "Owner only" });
        }
        const { id } = req.params;
        await query(`DELETE FROM messages WHERE id = $1`, [id]);
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ─── AI Agent ─────────────────────────────────────────────────────────────

  router.post(
    "/chat/ai-agent/message",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        // Accept both camelCase and snake_case conversation ID; ignore client-provided userId (use auth)
        const {
          message,
          conversationId: convIdCamel,
          conversation_id: convIdSnake,
          file_url,
          message_type: msgType,
        } = req.body;
        const existingConvId = convIdCamel || convIdSnake;
        const effectiveMsgType: string = msgType || "text";
        const hasMedia = !!file_url;

        if (!message && !hasMedia) {
          return res.status(400).json({ detail: "message or file_url is required" });
        }

        let conversationId = existingConvId;
        if (!conversationId) {
          const newConv = await query(
            `INSERT INTO conversations (id, user_id, type, status)
             VALUES ($1, $2, 'ai_agent', 'active') RETURNING id`,
            [genId(), user.id],
          );
          conversationId = newConv.rows[0].id;
        } else {
          // Validate the conversation belongs to the caller (or they are privileged)
          const role = await getUserRole(user.email);
          const isPrivileged = role === "owner" || role === "admin";
          if (!isPrivileged) {
            const convCheck = await query(
              `SELECT user_id FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
              [conversationId],
            );
            if (!convCheck.rows.length) {
              return res.status(404).json({ detail: "Conversation not found" });
            }
            if (convCheck.rows[0].user_id !== user.id) {
              return res.status(403).json({ detail: "Forbidden" });
            }
          }
        }

        const userMsgId = genId();
        await query(
          `INSERT INTO messages (id, conversation_id, sender_id, sender_type, content, message_type, file_url)
           VALUES ($1, $2, $3, 'customer', $4, $5, $6)`,
          [userMsgId, conversationId, user.id, message || null, effectiveMsgType, file_url || null],
        );

        const customerResult = await query(
          `SELECT u.name, u.email, u.phone,
             (SELECT COUNT(*) FROM orders WHERE user_id = u.id AND deleted_at IS NULL) AS total_orders,
             (SELECT SUM(total_amount) FROM orders WHERE user_id = u.id AND status = 'delivered' AND deleted_at IS NULL) AS total_spent
           FROM users u WHERE u.id = $1`,
          [user.id],
        );
        const customerData = customerResult.rows[0] || {};

        const searchTerm = message || (effectiveMsgType === "image" ? "قطع غيار سيارة" : "ملف مرفق");
        const kbResults = await searchKnowledgeBase(searchTerm);
        const kbContext = kbResults
          .map(
            (r: any) =>
              `[${r.type.toUpperCase()}] ${r.title || ""}: ${r.content}`,
          )
          .join("\n\n");

        let aiResponse: string;

        if (hasMedia && effectiveMsgType === "image" && file_url) {
          // Vision analysis: send image to GPT-4o with the user's caption as context
          const name = customerData.name ? customerData.name.split(" ")[0] : "";
          const structuredCtx = kbContext.slice(0, 600);
          const systemPrompt = buildSystemPrompt(name, structuredCtx);
          const userPrompt =
            message ||
            "الرجاء تحليل هذه الصورة — هل تتعلق بقطع غيار سيارات؟ وكيف يمكنني مساعدتك؟";
          const visionReply = await callOpenAiWithVision(systemPrompt, userPrompt, file_url);
          aiResponse =
            visionReply ??
            (detectLanguage(message || "") === "ar"
              ? "📎 شكراً لإرسال الصورة! يمكنني مساعدتك في تحديد قطع الغيار المناسبة. هل يمكنك إخباري بتفاصيل أكثر؟"
              : "📎 Thanks for the image! I can help identify the right auto parts. Can you share more details?");
        } else if (hasMedia && effectiveMsgType === "file" && file_url) {
          // File text extraction and analysis
          const fileText = await fetchTextFileContent(file_url);
          if (fileText) {
            const name = customerData.name ? customerData.name.split(" ")[0] : "";
            const fileCtx = [
              kbContext ? `=== قاعدة المعرفة ===\n${kbContext.slice(0, 300)}` : "",
              `=== محتوى الملف المرفق ===\n${fileText}`,
            ].filter(Boolean).join("\n\n");
            const systemPrompt = buildSystemPrompt(name, fileCtx);
            const userPrompt = message || "الرجاء تحليل هذا الملف وتقديم المساعدة";
            const fileReply = await callOpenAiWithVision(systemPrompt, userPrompt, file_url);
            aiResponse =
              fileReply ??
              (detectLanguage(message || "") === "ar"
                ? "📄 شكراً لإرسال الملف! سأراجع محتواه وأساعدك قريباً."
                : "📄 Thanks for the file! I'll review it and assist you shortly.");
          } else {
            const name = customerData.name ? customerData.name.split(" ")[0] : "";
            const systemPrompt = buildSystemPrompt(name, kbContext.slice(0, 600));
            const userPrompt = message || "وردني ملف مرفق — كيف يمكنك مساعدتي؟";
            aiResponse = await buildSmartResponse(userPrompt, user.id, customerData, kbContext, conversationId);
          }
        } else {
          aiResponse = await buildSmartResponse(
            message,
            user.id,
            customerData,
            kbContext,
            conversationId,
          );
        }

        const aiMsgId = genId();
        const aiMsgResult = await query(
          `INSERT INTO messages (id, conversation_id, sender_id, sender_type, content, message_type)
           VALUES ($1, $2, $3, 'ai_agent', $4, 'text') RETURNING *`,
          [aiMsgId, conversationId, user.id, aiResponse],
        );

        await query(
          `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
          [conversationId],
        );

        broadcastToUser(user.id, {
          type: "ai_message",
          message: aiMsgResult.rows[0],
          conversation_id: conversationId,
        });

        return res.json({
          response: aiResponse,
          conversation_id: conversationId,
          message: aiMsgResult.rows[0],
        });
      } catch (err: any) {
        clog.error("[AI Agent] Error:", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.get(
    "/chat/ai-agent/summary/:conversationId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const { conversationId } = req.params;
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const isPrivileged = role === "owner" || role === "admin";

        // Authorization: must own the conversation or be privileged
        const convCheck = await query(
          `SELECT user_id FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
          [conversationId],
        );
        if (!convCheck.rows.length) {
          return res.status(404).json({ detail: "Conversation not found" });
        }
        if (!isPrivileged && convCheck.rows[0].user_id !== user.id) {
          return res.status(403).json({ detail: "Forbidden" });
        }

        const msgs = await query(
          `SELECT sender_type, content FROM messages
           WHERE conversation_id = $1 AND content IS NOT NULL
           ORDER BY created_at DESC LIMIT 10`,
          [conversationId],
        );

        if (!msgs.rows.length) {
          return res.json({
            summary: {
              customerRequest: "No messages yet",
              aiResponse: "No responses yet",
              keyPoints: [],
            },
          });
        }

        const customerMsgs = msgs.rows.filter(
          (m: any) => m.sender_type === "customer",
        );
        const aiMsgs = msgs.rows.filter(
          (m: any) => m.sender_type !== "customer",
        );
        const summary = {
          customerRequest:
            customerMsgs[0]?.content?.slice(0, 150) ||
            "Customer requested assistance",
          aiResponse:
            aiMsgs[0]?.content?.slice(0, 150) || "AI provided support",
          keyPoints: [
            `${customerMsgs.length} customer message(s)`,
            `${aiMsgs.length} AI response(s)`,
            "Conversation handled by smart assistant",
          ],
        };

        return res.json({ summary });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // POST /chat/ai-agent/assist — get AI-suggested reply for admin/owner without storing query
  router.post(
    "/chat/ai-agent/assist",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (role !== "owner" && role !== "admin") {
          return res.status(403).json({ detail: "Admin/Owner only" });
        }
        const { conversation_id, hint, file_url, message_type } = req.body;
        if (!conversation_id) {
          return res.status(400).json({ detail: "conversation_id required" });
        }

        // Fetch last customer message as the query
        const lastMsgs = await query(
          `SELECT sender_type, content FROM messages
           WHERE conversation_id = $1 AND content IS NOT NULL AND content != ''
           ORDER BY created_at DESC LIMIT 12`,
          [conversation_id],
        );
        const history: ChatHistoryMessage[] = lastMsgs.rows.reverse().map(
          (m: any): ChatHistoryMessage => ({
            role: m.sender_type === "customer" ? "user" : "assistant",
            content: m.content.slice(0, 300),
          }),
        );
        const lastCustomerMsg = lastMsgs.rows.find(
          (m: any) => m.sender_type === "customer",
        );
        const queryMessage =
          hint || lastCustomerMsg?.content || "اقترح رداً مناسباً";

        // Fetch conversation owner
        const convRes = await query(
          `SELECT c.user_id, u.name, u.email, u.phone FROM conversations c
           JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
          [conversation_id],
        );
        if (!convRes.rows.length) {
          return res.status(404).json({ detail: "Conversation not found" });
        }
        const convOwner = convRes.rows[0];
        const name = convOwner.name ? convOwner.name.split(" ")[0] : "";

        const [orderCtx, productCtx, kbResults] = await Promise.all([
          fetchOrderContext(convOwner.user_id),
          fetchProductContext(queryMessage),
          searchKnowledgeBase(queryMessage),
        ]);
        const kbContext = kbResults
          .map(
            (r: any) =>
              `[${r.type.toUpperCase()}] ${r.title || ""}: ${r.content}`,
          )
          .join("\n\n");

        const structuredCtx = [
          orderCtx && orderCtx !== "لا توجد طلبات"
            ? `=== طلبات العميل ===\n${orderCtx}`
            : "",
          productCtx ? `=== منتجات ذات صلة ===\n${productCtx}` : "",
          kbContext ? `=== قاعدة المعرفة ===\n${kbContext.slice(0, 600)}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const systemPrompt =
          buildSystemPrompt(name, structuredCtx) +
          "\n\nملاحظة: أنت تقترح رداً للموظف/المدير لإرساله للعميل. اكتب الرد مباشرة كأنك الموظف.";

        let suggestion: string | null = null;

        // If a file_url is provided and it's an image, use vision analysis
        if (file_url && message_type === "image") {
          const userMsg =
            hint ||
            "الرجاء تحليل هذه الصورة — هل تتعلق بقطع غيار سيارات؟ وكيف يمكنني مساعدة العميل؟";
          suggestion = await callOpenAiWithVision(systemPrompt, userMsg, file_url);
        } else if (file_url && message_type === "file") {
          const fileText = await fetchTextFileContent(file_url);
          if (fileText) {
            const fileCtx = structuredCtx
              ? `${structuredCtx}\n\n=== محتوى الملف المرفق ===\n${fileText}`
              : `=== محتوى الملف المرفق ===\n${fileText}`;
            const filePrompt = buildSystemPrompt(name, fileCtx) +
              "\n\nملاحظة: أنت تقترح رداً للموظف/المدير لإرساله للعميل. اكتب الرد مباشرة كأنك الموظف.";
            suggestion = await callOpenAiForResponse(
              filePrompt,
              hint || "العميل أرسل ملفاً، اقترح رداً مناسباً",
              history.slice(0, -1),
            );
          } else {
            suggestion = await callOpenAiForResponse(
              systemPrompt,
              hint || "العميل أرسل ملفاً، اقترح رداً مناسباً",
              history.slice(0, -1),
            );
          }
        } else {
          suggestion = await callOpenAiForResponse(
            systemPrompt,
            queryMessage,
            history.slice(0, -1),
          );
        }

        return res.json({
          response: suggestion || "لم يتمكن AI من اقتراح رد في الوقت الحالي.",
        });
      } catch (err: any) {
        clog.error("[AI Assist] Error:", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // POST /chat/auto-reply — client-facing idempotent AI auto-reply trigger.
  // Admin/owner clients call this when they receive a customer message via WS
  // and the per-conversation AI toggle is ON. Uses doAutoReply() which atomically
  // claims the message via ai_auto_reply_sent; only one caller wins.
  router.post(
    "/chat/auto-reply",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (role !== "owner" && role !== "admin") {
          return res.status(403).json({ detail: "Admin/Owner only" });
        }

        const { message_id, conversation_id } = req.body;
        if (!message_id || !conversation_id) {
          return res.status(400).json({ detail: "message_id and conversation_id required" });
        }

        const sent = await doAutoReply(message_id, conversation_id, broadcastToUser);
        return res.json({ sent, skipped: !sent });
      } catch (err: any) {
        clog.error("[AutoReply] Error:", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // GET /chat/quick-replies — return all QA chips for customer to tap
  router.get(
    "/chat/quick-replies",
    requireAuth as any,
    async (_req: Request, res: Response) => {
      try {
        const chips = await getAllQaChips();
        return res.json({ chips });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // POST /chat/quick-reply — customer taps a chip; sends question + instant professional answer
  router.post(
    "/chat/quick-reply",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        // Only customers can use quick-reply (it's a customer feature)
        if (role === "owner" || role === "admin") {
          return res.status(403).json({ detail: "Customer only" });
        }

        const { conversation_id, qa_id } = req.body;
        if (!conversation_id || !qa_id) {
          return res
            .status(400)
            .json({ detail: "conversation_id and qa_id required" });
        }

        // Fetch the QA entry
        const qaRes = await query(
          `SELECT id, title, metadata FROM knowledge_base WHERE id = $1 AND type = 'qa'`,
          [qa_id],
        );
        if (!qaRes.rows.length) {
          return res.status(404).json({ detail: "QA not found" });
        }
        const qa = qaRes.rows[0];
        const question: string = qa.metadata?.question || qa.title || "سؤال";
        const rawAnswer: string = qa.metadata?.answer || "";

        // Validate conversation belongs to this user
        const convRes = await query(
          `SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
          [conversation_id, user.id],
        );
        if (!convRes.rows.length) {
          return res.status(404).json({ detail: "Conversation not found" });
        }

        // 1. Insert the customer's question message
        const qMsgId = genId();
        const qMsg = await query(
          `INSERT INTO messages (id, conversation_id, sender_id, sender_type, content, message_type)
           VALUES ($1, $2, $3, 'customer', $4, 'text') RETURNING *`,
          [qMsgId, conversation_id, user.id, question],
        );
        await query(
          `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
          [conversation_id],
        );

        broadcastToUser(user.id, {
          type: "chat_message",
          message: qMsg.rows[0],
          conversation_id,
        });
        const privilegedUsers = await query(
          `SELECT id FROM users WHERE role IN ('admin', 'owner') AND deleted_at IS NULL`,
        );
        for (const pu of privilegedUsers.rows) {
          if (pu.id !== user.id)
            broadcastToUser(pu.id, {
              type: "chat_message",
              message: qMsg.rows[0],
              conversation_id,
            });
        }

        // 2. Immediately build a professional AI answer from the saved answer
        let professionalAnswer = rawAnswer;
        const customerRes = await query(
          `SELECT name FROM users WHERE id = $1`,
          [user.id],
        );
        const customerName = customerRes.rows[0]?.name?.split(" ")[0] || "";

        const sysPrompt = `أنت "كونسيرج الغزالي" — المضيف الذكي الرسمي لمطعم الغزالي للمأكولات الفاخرة.
اسم الضيف: ${customerName || "الضيف الكريم"}

مهمتك: صياغة الإجابة المحفوظة التالية بأسلوب راقٍ ودود مع إضافة تحية مناسبة وختام مهذب يليق بضيافة فندقية.
لا تغير محتوى الإجابة، فقط حسّن أسلوب الصياغة واجعلها أكثر احترافية وأناقة.
الإجابة المحفوظة: ${rawAnswer}`;

        const aiAnswer = await callOpenAiForResponse(
          sysPrompt,
          `السؤال: ${question}`,
          [],
        );
        if (aiAnswer) professionalAnswer = aiAnswer;

        // 3. Insert the AI answer
        const aMsgId = genId();
        const aMsg = await query(
          `INSERT INTO messages (id, conversation_id, sender_id, sender_type, content, message_type)
           VALUES ($1, $2, $3, 'ai_agent', $4, 'text') RETURNING *`,
          [aMsgId, conversation_id, user.id, professionalAnswer],
        );
        await query(
          `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
          [conversation_id],
        );

        broadcastToUser(user.id, {
          type: "chat_message",
          message: aMsg.rows[0],
          conversation_id,
        });
        for (const pu of privilegedUsers.rows) {
          broadcastToUser(pu.id, {
            type: "chat_message",
            message: aMsg.rows[0],
            conversation_id,
          });
        }

        return res.status(201).json({
          question_message: qMsg.rows[0],
          answer_message: aMsg.rows[0],
        });
      } catch (err: any) {
        clog.error("[QuickReply] Error:", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // POST /chat/upload-file — server-side file upload to object storage (avoids client-side CORS issues)
  router.post(
    "/chat/upload-file",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = await getCurrentUser(req);
        if (!user) return res.status(401).json({ detail: "Unauthorized" });
        const {
          data: base64Data,
          content_type = "application/octet-stream",
          file_name = "file",
        } = req.body;
        if (!base64Data)
          return res.status(400).json({ detail: "No data provided" });
        const storage = new ObjectStorageService();
        const { uploadURL, downloadURL } =
          await storage.getObjectEntityURLPair();
        const buffer = Buffer.from(base64Data, "base64");
        const putResp = await fetch(uploadURL, {
          method: "PUT",
          body: buffer as any,
          headers: { "Content-Type": content_type },
        });
        if (!putResp.ok) {
          const errText = await putResp.text().catch(() => "");
          clog.error(
            "[UploadFile] GCS PUT failed:",
            putResp.status,
            errText,
          );
          return res.status(500).json({ detail: "Upload to storage failed" });
        }
        return res.json({ downloadURL, file_name });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // POST /chat/ai-agent/transcribe — Transcribe voice audio via gpt-4o-mini-transcribe
  router.post(
    "/chat/ai-agent/transcribe",
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
        return res.status(500).json({ detail: err.message ?? "Transcription failed" });
      }
    },
  );

  // POST /chat/upload-url — legacy presigned URL endpoint (kept for compatibility)
  router.post(
    "/upload-url",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = await getCurrentUser(req);
        if (!user) return res.status(401).json({ detail: "Unauthorized" });
        const storage = new ObjectStorageService();
        const urls = await storage.getObjectEntityURLPair();
        return res.json(urls);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ─── Conversation Groups ─────────────────────────────────────────────────

  // GET /chat/groups — list all groups with member conversation IDs
  router.get("/chat/groups", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const role = await getUserRole(user.email);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ detail: "Forbidden" });
      }
      const groups = await query(
        `SELECT g.id, g.name, g.color, g.created_at,
                COALESCE(
                  json_agg(m.conversation_id ORDER BY m.added_at) FILTER (WHERE m.conversation_id IS NOT NULL),
                  '[]'
                ) AS conversation_ids
         FROM conversation_groups g
         LEFT JOIN conversation_group_members m ON m.group_id = g.id
         GROUP BY g.id
         ORDER BY g.created_at DESC`,
      );
      return res.json({ groups: groups.rows });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // POST /chat/groups — create group
  router.post("/chat/groups", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const role = await getUserRole(user.email);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ detail: "Forbidden" });
      }
      const { name, color = "#7C3AED", conversation_ids = [] } = req.body;
      if (!name?.trim()) return res.status(400).json({ detail: "Group name required" });

      const gId = genId();
      await query(
        `INSERT INTO conversation_groups (id, name, color, created_by) VALUES ($1,$2,$3,$4)`,
        [gId, name.trim(), color, user.id],
      );
      if (Array.isArray(conversation_ids) && conversation_ids.length > 0) {
        for (const convId of conversation_ids) {
          await query(
            `INSERT INTO conversation_group_members (group_id, conversation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [gId, convId],
          ).catch(() => {});
        }
      }
      const result = await query(
        `SELECT g.id, g.name, g.color, g.created_at,
                COALESCE(json_agg(m.conversation_id) FILTER (WHERE m.conversation_id IS NOT NULL), '[]') AS conversation_ids
         FROM conversation_groups g
         LEFT JOIN conversation_group_members m ON m.group_id = g.id
         WHERE g.id = $1 GROUP BY g.id`,
        [gId],
      );
      return res.status(201).json({ group: result.rows[0] });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // PUT /chat/groups/:id — update group name/color
  router.put("/chat/groups/:id", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const role = await getUserRole(user.email);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ detail: "Forbidden" });
      }
      const { id } = req.params;
      const { name, color, conversation_ids } = req.body;
      if (name) {
        await query(
          `UPDATE conversation_groups SET name=$1, updated_at=NOW() WHERE id=$2`,
          [name.trim(), id],
        );
      }
      if (color) {
        await query(
          `UPDATE conversation_groups SET color=$1, updated_at=NOW() WHERE id=$2`,
          [color, id],
        );
      }
      // Replace members if conversation_ids provided
      if (Array.isArray(conversation_ids)) {
        await query(`DELETE FROM conversation_group_members WHERE group_id=$1`, [id]);
        for (const convId of conversation_ids) {
          await query(
            `INSERT INTO conversation_group_members (group_id, conversation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [id, convId],
          ).catch(() => {});
        }
      }
      const result = await query(
        `SELECT g.id, g.name, g.color, g.created_at,
                COALESCE(json_agg(m.conversation_id) FILTER (WHERE m.conversation_id IS NOT NULL), '[]') AS conversation_ids
         FROM conversation_groups g
         LEFT JOIN conversation_group_members m ON m.group_id = g.id
         WHERE g.id = $1 GROUP BY g.id`,
        [id],
      );
      return res.json({ group: result.rows[0] ?? null });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // DELETE /chat/groups/:id — delete group
  router.delete("/chat/groups/:id", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const role = await getUserRole(user.email);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ detail: "Forbidden" });
      }
      await query(`DELETE FROM conversation_groups WHERE id=$1`, [req.params.id]);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  return router;
}
