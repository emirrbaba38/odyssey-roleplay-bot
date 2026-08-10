import { GoogleGenAI } from "@google/genai";

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

  const ai = new GoogleGenAI({ apiKey: apiKey });

  const response = await ai.models.generateContent({
    model: 'gemini-1.5-flash',
    contents: [
      { text: SYSTEM_PROMPT },
      { text: text }
    ],
    config: {
      maxOutputTokens: 700,
    }
  });

  return response.text?.trim() || "⚠️ Analiz alınamadı, boş yanıt döndü.";
}
