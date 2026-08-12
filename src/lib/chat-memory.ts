import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = `${__dirname}/../../data/chat-memory.json`;

// Kullanıcı başına tutulan mesaj sayısı (user+model çifti olarak MAX_TURNS kadar).
const MAX_TURNS = 12;

export type ChatPart = { text: string };
export type ChatEntry = { role: "user" | "model"; parts: ChatPart[] };
type MemoryMap = Record<string, ChatEntry[]>;

function loadMemory(): MemoryMap {
  try {
    if (!existsSync(MEMORY_FILE)) return {};
    const raw = readFileSync(MEMORY_FILE, "utf-8");
    return JSON.parse(raw) as MemoryMap;
  } catch (err) {
    console.error("[chat-memory] hafıza okunamadı:", err);
    return {};
  }
}

function saveMemory(memory: MemoryMap): void {
  try {
    mkdirSync(dirname(MEMORY_FILE), { recursive: true });
    writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), "utf-8");
  } catch (err) {
    console.error("[chat-memory] hafıza kaydedilemedi:", err);
  }
}

/** Belirtilen kullanıcının şu ana kadarki konuşma geçmişini döner (Gemini `contents` formatında). */
export function getHistory(userId: string): ChatEntry[] {
  const memory = loadMemory();
  return memory[userId] ?? [];
}

/** Kullanıcının geçmişine yeni bir user+model konuşma turunu ekler ve diske kaydeder. */
export function appendExchange(userId: string, userText: string, modelText: string): void {
  const memory = loadMemory();
  const history = memory[userId] ?? [];

  history.push({ role: "user", parts: [{ text: userText }] });
  history.push({ role: "model", parts: [{ text: modelText }] });

  // Sadece son MAX_TURNS turu (2 * MAX_TURNS entry) tut, eskiyi at.
  const trimmed = history.slice(-MAX_TURNS * 2);

  memory[userId] = trimmed;
  saveMemory(memory);
}

/** Belirtilen kullanıcının hafızasını tamamen siler. */
export function clearHistory(userId: string): void {
  const memory = loadMemory();
  delete memory[userId];
  saveMemory(memory);
}
