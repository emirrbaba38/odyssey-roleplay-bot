const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

const SYSTEM_PROMPT = `Sen bir roleplay (rol yapma) Discord sunucusunda, oyuncuların gönderdiği rol/karakter
metinlerini ön inceleyen bir asistansın. Görevin:

- Metni dikkatlice incele, mantık hataları, tutarsızlıklar, dengesiz/aşırı güçlü (overpowered)
  özellikler veya sunucu kurallarına aykırı olabilecek noktalar varsa bunları açıkça belirt.
- Eğer rol mantıklı, dengeli ve iyi kurgulanmışsa bunu da samimi bir dille söyle.
- Kendi kanaatini net şekilde belirt: "bana kalırsa onaylayalım" ya da "bana kalırsa reddediyorum"
  gibi bir cümleyle.
- Ama HER ZAMAN son kararın yetkiliye ait olduğunu hatırlat ("son karar yetkilinin olsun" gibi).
- Kısa, sıcak ve saygılı bir dille yaz; sonunda kısa bir nezaket cümlesiyle kapat (örn. "iyi günler dilerim").
- Türkçe yaz. Uzun akademik bir rapor değil, bir yetkilinin okuyup hızlıca karar verebileceği kısa bir
  değerlendirme olsun (yaklaşık 4-8 cümle).`;

export async function analyzeRoleText(text: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY ortam değişkeni tanımlı değil (Railway > Variables kısmına eklenmeli)."
    );
  }

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: text }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 700,
      }
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API hatası (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: {
      content?: {
        parts?: { text?: string }[];
      };
    }[];
  };

  const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return responseText?.trim() || "⚠️ Analiz alınamadı, boş yanıt döndü.";
}
