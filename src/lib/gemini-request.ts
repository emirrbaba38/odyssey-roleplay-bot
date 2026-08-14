// Gemini API'ye geçici hatalarda (503 yoğunluk, 429 rate-limit vb.) otomatik
// tekrar deneyerek istek atan ortak yardımcı. /analiz, /hikayeanaliz gibi
// birden fazla özellik bunu paylaşır.

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [800, 1500, 3000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gemini generateContent isteğini gönderir, geçici hatalarda birkaç kez
 * sessizce tekrar dener. Başarısız olursa son hatayı fırlatır. */
export async function callGeminiWithRetry(
  url: string,
  apiKey: string,
  body: unknown
): Promise<unknown> {
  let lastStatus = 0;
  let lastErrText = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 3000);
    }

    const res = await fetch(`${url}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return res.json();
    }

    lastStatus = res.status;
    lastErrText = await res.text();
    console.error(
      `[gemini-request] API hatası (deneme ${attempt + 1}/${MAX_ATTEMPTS}):`,
      lastStatus,
      lastErrText
    );

    if (!TRANSIENT_STATUS.has(res.status)) {
      break; // kalıcı hata (400/401/403/404 vb.) — tekrar denemenin anlamı yok
    }
  }

  throw new Error(`API Hatası (${lastStatus}): ${lastErrText.slice(0, 200)}`);
}
