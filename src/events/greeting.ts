import { Client, Message } from "discord.js";

const SELAM_KALIPLARI = [
  "sa",
  "selamün aleyküm",
  "selamun aleykum",
  "selamünaleyküm",
  "selamunaleykum",
  "selamüaleyküm",
];

export function registerGreeting(client: Client): void {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;

    const content = message.content.trim().toLowerCase();
    if (!SELAM_KALIPLARI.includes(content)) return;

    try {
      await message.reply(
        "Aleyküm Selam kardeşim hoşgeldin bereket getirdin nasılsın iyimisin"
      );
    } catch (err) {
      console.error("[selamlaşma] Cevap gönderilemedi:", err);
    }
  });
}
