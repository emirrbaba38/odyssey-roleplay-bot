import { Client, Message } from "discord.js";

// Tetikleyici: mesaj "bot " ile başlıyorsa devamı Gemini'ye gönderilir. (/bot değil, direkt yazı)
const TRIGGER_PREFIX = "bot ";
const GEMINI_MODEL = "gemini-3.5-flash";
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
  "istekleri normal bir şekilde karşılayabilirsin. Türkçe, samimi ve kısa cevaplar ver.";

export function registerGeminiChat(client: Client): void {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.trim();
    if (!content.toLowerCase().startsWith(TRIGGER_PREFIX)) return;

    const prompt = content.slice(TRIGGER_PREFIX.length).trim();
    if (!prompt) return;

    const apiKey = process.env.GEMINI_API_KEY_SOHBET;
    if (!apiKey) {
      console.error("[gemini-chat] GEMINI_API_KEY_SOHBET ortam değişkeni tanımlı değil.");
      await message
        .reply("❌ Şu an yapılandırılmadım, bir yetkiliye haber ver.")
        .catch(() => {});
      return;
    }

    if (message.channel.isSendable()) {
      await message.channel.sendTyping().catch(() => {});
    }

    try {
      const response = await fetch(GEMINI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[gemini-chat] API hatası:", response.status, errText);
        await message
          .reply("❌ Şu an cevap veremiyorum, birazdan tekrar dener misin?")
          .catch(() => {});
        return;
      }

      const data = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!reply) {
        await message
          .reply("❌ Bir cevap üretemedim, farklı bir şekilde sorar mısın?")
          .catch(() => {});
        return;
      }

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
