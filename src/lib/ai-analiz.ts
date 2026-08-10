import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_PROMPT = `Sen bir roleplay (rol yapma) Discord sunucusunda, oyuncuların gönderdiği rol/karakter metinlerini ön inceleyen bir asistansın.
Görevin:
- Metni dikkatlice incele, mantık hataları, tutarsızlıklar, aşırı güçlü (overpowered) özellikler veya sunucu kurallarına aykırı noktalar varsa bunları belirt.
- Rol mantıklı ve dengeliyse bunu samimi bir dille onayla.
- Kanaatini net belirt: "bana kalırsa onaylayalım" ya da "bana kalırsa reddediyorum" gibi.
- Son kararın yetkiliye ait olduğunu hatırlat.
- Kısa, sıcak, saygılı ve Türkçe yaz. 4-8 cümlelik bir değerlendirme olsun.`;

export async function analyzeRoleText(text: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY ortam değişkeni tanımlı değil (Railway > Variables kısmına eklenmeli).");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: SYSTEM_PROMPT 
  });

  const result = await model.generateContent(text);
  return result.response.text() || "⚠️ Analiz alınamadı, boş yanıt döndü.";
}
