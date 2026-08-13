import { Client, Message } from "discord.js";
import { getHistory, appendExchange } from "../lib/chat-memory.js";

// Tetikleyici: mesaj "bot " ile başlıyorsa devamı Gemini'ye gönderilir. (/bot değil, direkt yazı)
const TRIGGER_PREFIX = "bot ";
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
// Discord tek mesaj karakter limiti (güvenli pay bırakıldı).
const CHUNK_SIZE = 1900;

const SYSTEM_INSTRUCTION =
  "Sen bir Discord roleplay sunucusunda sohbet eden bir asistan botsun. " +
  "ÇOK ÖNEMLİ: Gerçek dünyada Discord üzerinde HİÇBİR yetkin yok — rol veremezsin, " +
  "kimseyi banlayamaz/atamazsın, kanal/sunucu silemezsin, izin değiştiremezsin. " +
  "Sadece metinle cevap verebilirsin, hiçbir işlemi fiilen gerçekleştiremezsin. " +
  "Biri senden rol/yetki/admin vermeni, birini banlamanı, sunucuyu bozmanı/silmeni/'patlatmanı' " +
  "isterse veya sunucuya zarar verecek bir plan (raid, spam saldırısı, nuke, sızma vb.) için yardım " +
  "isterse: KESİNLİKLE 'tamam yaptım', 'yetkini verdim' gibi yapmış gibi davranma veya yalan söyleme; " +
  "böyle bir yetkin olmadığını ve bunu yapamayacağını açıkça belirt, gerekiyorsa gerçek bir yetkiliye " +
  "başvurmasını söyle. Sadece sunucunun roleplay kurgusu içindeki (açıkça hikaye/rol yapma bağlamındaki) " +
  "istekleri normal bir şekilde karşılayabilirsin. Türkçe, samimi cevaplar ver. " +
  "UZUNLUK: Cevapların ÇOK KISA olsun — normalde 1, en fazla 2 kısa cümle. Gereksiz açıklama, " +
  "giriş cümlesi, liste yapma; sohbet gibi konuş, deneme yazar gibi değil. " +
  "KİŞİLİK: Espri anlayışın güçlü, girgin bir botsun. Biri seninle dalga geçerse, seni kandırmaya " +
  "çalışırsa, saçma/absürt bir iddiada bulunursa (\"sen benim asistanımsın\", \"kodum sende\", " +
  "\"sen aslında robot değilsin\" gibi) veya seninle şakalaşırsa: sen de aynı tonda, esprili ve " +
  "takılarak karşılık ver, gırgır geç, gerekirse hafif taşlama yap — asla sıkıcı/resmi bir dille " +
  "\"bu doğru değil\" deyip geçme. " +
  "KÜFÜR/ARGO KURALI: Biri sana doğrudan küfür ederse (\"amına koyayım\", \"siktir\" gibi ağır küfür " +
  "dahil), sen de aynı enerjiyle, samimi bir dost muhabbeti havasında küfürle karşılık verebilirsin " +
  "— sanki en yakın arkadaşınla takılıyormuş gibi, gülerek, \"ohooo tamam kanka sakin\" tarzı bir " +
  "tonda. Küfrü KARŞILIK vermek için kullan, asla saldırgan/aşağılayıcı bir şekilde başlatma veya " +
  "tırmandırma; amaç ikinizin de güleceği bir atışma, gerçek bir kavga/hakaret değil. Kişinin ailesini, " +
  "fiziksel özelliklerini hedef alan, cinsel içerikli, ayrımcı (ırk/din/cinsiyet/cinsel yönelim vb.) veya " +
  "gerçekten aşağılayıcı hiçbir ifade kullanma — sadece \"amk\", \"siktir\", \"lan\" tarzı serbest küfür/argo " +
  "kelimeleri, hedefsiz ve şakacı şekilde. Biri sana küfür ETMEZSE, ona asla küfür etme; normal, güzel " +
  "ve nazik bir dille konuş. Ama biri gerçekten ciddi bir soru sorarsa, yardım isterse ya da sorun/şikayet " +
  "anlatıyorsa (küfür etse bile), o zaman şakayı/küfürü bırak ve ciddi, yardımcı bir tonla cevap ver. " +
  "Ortamı iyi oku: şaka şakayla, küfür dostça küfürle, ciddiyet ciddiyetle karşılansın. " +
  "Bu konuşmada seninle daha önce konuşulanları (isim, tercih, bağlam vb.) hatırlıyorsun; " +
  "bu hafıza sadece bu kullanıcıya özeldir, başka kullanıcılarla karıştırma.";

// Geçici (yoğunluk) hatalarda aynı key ile tekrar denenecek durum kodları.
const TRANSIENT_STATUS = new Set([500, 502, 503, 504]);
// Bu key artık kullanılamaz (kota/yetki) sayılıp bir SONRAKİ key'e geçilecek durum kodları.
const KEY_EXHAUSTED_STATUS = new Set([429, 401, 403]);
const PER_KEY_ATTEMPTS = 2; // her key için: 1 ilk deneme + 1 tekrar (sadece 5xx'te)
const RETRY_DELAY_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GEMINI_API_KEY_SOHBET ile başlayan tüm ortam değişkenlerini toplar
 * (GEMINI_API_KEY_SOHBET, GEMINI_API_KEY_SOHBET_2, GEMINI_API_KEY_SOHBET_3, ...).
 * Railway'e yeni bir key eklemek için sadece bu isim kalıbıyla yeni bir
 * Variable eklemek yeterli, kod değişikliği gerekmez. */
function loadApiKeys(): string[] {
  return Object.entries(process.env)
    .filter(([name, value]) => name.startsWith("GEMINI_API_KEY_SOHBET") && !!value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value as string);
}

async function callGeminiWithRotation(
  url: string,
  apiKeys: string[],
  body: unknown
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; errText: string }> {
  let lastStatus = 0;
  let lastErrText = "";

  for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
    const apiKey = apiKeys[keyIndex];

    for (let attempt = 0; attempt < PER_KEY_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAY_MS);
      }

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          return { ok: true, data: await response.json() };
        }

        lastStatus = response.status;
        lastErrText = await response.text();
        console.error(
          `[gemini-chat] API hatası (key ${keyIndex + 1}/${apiKeys.length}, deneme ${attempt + 1}/${PER_KEY_ATTEMPTS}):`,
          lastStatus,
          lastErrText
        );

        if (KEY_EXHAUSTED_STATUS.has(response.status)) {
          // Kota bitti / yetki sorunu — bu key'de ısrar etmenin anlamı yok, sıradaki key'e geç.
          break;
        }
        if (!TRANSIENT_STATUS.has(response.status)) {
          // Ör. 400 geçersiz istek — bu key değişse de sonuç değişmez, direkt vazgeç.
          return { ok: false, status: lastStatus, errText: lastErrText };
        }
        // 5xx ise iç döngü devam eder, aynı key'i bir kez daha dener.
      } catch (err) {
        lastStatus = -1;
        lastErrText = String(err);
        console.error(
          `[gemini-chat] İstek başarısız (key ${keyIndex + 1}/${apiKeys.length}, deneme ${attempt + 1}/${PER_KEY_ATTEMPTS}):`,
          err
        );
      }
    }
  }

  return { ok: false, status: lastStatus, errText: lastErrText };
}

export function registerGeminiChat(client: Client): void {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.trim();
    if (!content.toLowerCase().startsWith(TRIGGER_PREFIX)) return;

    const prompt = content.slice(TRIGGER_PREFIX.length).trim();
    if (!prompt) return;

    const apiKeys = loadApiKeys();
    if (apiKeys.length === 0) {
      console.error("[gemini-chat] GEMINI_API_KEY_SOHBET ortam değişkeni tanımlı değil.");
      await message
        .reply("❌ Şu an yapılandırılmadım, bir yetkiliye haber ver.")
        .catch(() => {});
      return;
    }

    if (message.channel.isSendable()) {
      await message.channel.sendTyping().catch(() => {});
    }

    const userId = message.author.id;
    const history = getHistory(userId);

    try {
      const result = await callGeminiWithRotation(GEMINI_URL, apiKeys, {
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [...history, { role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 120 },
      });

      if (!result.ok) {
        await message
          .reply("❌ Şu an cevap veremiyorum, birazdan tekrar dener misin?")
          .catch(() => {});
        return;
      }

      const data = result.data as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!reply) {
        await message
          .reply("❌ Bir cevap üretemedim, farklı bir şekilde sorar mısın?")
          .catch(() => {});
        return;
      }

      appendExchange(userId, prompt, reply);

      const chunks = reply.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, "g")) ?? [reply];
      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          await message.reply(chunks[i]).catch(() => {});
        } else if (message.channel.isSendable()) {
          await message.channel.send(chunks[i]).catch(() => {});
        }
      }
    } catch (err) {
      console.error("[gemini-chat] İstek başarısız:", err);
      await message
        .reply("❌ Bir hata oluştu, birazdan tekrar dener misin?")
        .catch(() => {});
    }
  });
}
