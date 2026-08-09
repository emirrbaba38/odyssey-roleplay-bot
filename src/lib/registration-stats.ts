import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_FILE = `${__dirname}/../../data/registration-stats.json`;

type StatsMap = Record<string, number>;

function loadStats(): StatsMap {
  try {
    if (!existsSync(STATS_FILE)) return {};
    const raw = readFileSync(STATS_FILE, "utf-8");
    return JSON.parse(raw) as StatsMap;
  } catch (err) {
    console.error("[registration-stats] istatistikler okunamadı:", err);
    return {};
  }
}

function saveStats(stats: StatsMap): void {
  try {
    mkdirSync(dirname(STATS_FILE), { recursive: true });
    writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf-8");
  } catch (err) {
    console.error("[registration-stats] istatistikler kaydedilemedi:", err);
  }
}

/** Belirtilen kullanıcının yaptığı kayıt sayısını 1 artırır. */
export function incrementRegistration(userId: string): void {
  const stats = loadStats();
  stats[userId] = (stats[userId] ?? 0) + 1;
  saveStats(stats);
}

/** Tüm kayıt istatistiklerini, en çok kayıt edenden en aza sıralı şekilde döner. */
export function getAllRegistrationStats(): Array<{ userId: string; count: number }> {
  const stats = loadStats();
  return Object.entries(stats)
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count);
}

/** Tüm kayıt istatistiklerini sıfırlar. */
export function resetRegistrationStats(): void {
  saveStats({});
}
