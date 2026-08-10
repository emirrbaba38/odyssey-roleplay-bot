const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

const SYSTEM_PROMPT = `Sen bir roleplay Discord sunucusunda rol metinlerini inceleyen bir asistansın.
Görevin: Metni incele, mantık hatalarını veya kural dışı durumları belirt.
Kanaatini net belirt ("onaylayalım" ya da "reddediyorum" gibi). Son kararın yetkiliye ait olduğunu hatırlat. Türkçe, kısa ve samimi yaz.

Cevabını Discord markdown formatıyla, AŞAĞIDAKİ YAPIYA BİREBİR uyarak yaz (# tek diyez en büyük başlık boyutudur, embed içinde büyük ve okunaklı görünür):

# 📋 Tespitler
- İlk madde
- İkinci madde
(gerekirse daha fazla madde)

# ⚖️ Kanaat
Kısa gerekçeli kanaatin (onaylıyorum / reddediyorum gibi net bir ifadeyle başla).

Başlıkların dışına hiçbir şey ekleme, madde işaretlerini "-" ile yap, gereksiz uzatma.`;

export async function analyzeRoleText(text: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY bulunamadı!");

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\nİncelenecek Metin: ${text}` }] }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API Hatası (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Analiz alınamadı.";
}
