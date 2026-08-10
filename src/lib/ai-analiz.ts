const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";

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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY ortam değişkeni tanımlı değil (Railway > Variables kısmına eklenmeli)."
    );
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic API hatası (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };

  const textBlock = data.content?.find((c) => c.type === "text" && c.text);
  return textBlock?.text?.trim() || "⚠️ Analiz alınamadı, boş yanıt döndü.";
}
