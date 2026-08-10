import { Client, Events, EmbedBuilder, Colors, TextChannel } from "discord.js";
import { pendingRoleReviewChannels } from "../commands/ticket.js";
import { analyzeRoleText } from "../lib/ai-analiz.js";
import { TICKET_STAFF_ROLE_ID, findRoleById } from "../lib/permissions.js";

export function registerRolOnayReview(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!pendingRoleReviewChannels.has(message.channelId)) return;

    // Sadece ilk mesajı işle, tekrar tetiklenmesin.
    pendingRoleReviewChannels.delete(message.channelId);

    const content = message.content?.trim();
    if (!content) return;

    const channel = message.channel as TextChannel;
    const guild = message.guild;
    const staffRole = guild ? findRoleById(guild, TICKET_STAFF_ROLE_ID) : undefined;

    try {
      await channel.sendTyping().catch(() => {});
      const analysis = await analyzeRoleText(content);

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle("🤖 Yapay Zeka Ön İncelemesi")
        .setDescription(analysis)
        .setFooter({ text: "Bu bir ön değerlendirmedir, son karar yetkiliye aittir." })
        .setTimestamp();

      await channel.send({
        content: staffRole ? `<@&${staffRole.id}> son karar için bekleniyor.` : undefined,
        embeds: [embed],
        allowedMentions: { roles: staffRole ? [staffRole.id] : [] },
      });
    } catch (err) {
      console.error("[rol-onay-review] analiz hatası:", err);
      await channel
        .send("⚠️ Yapay zeka analizi şu anda yapılamadı, bir yetkili bu rolü manuel olarak inceleyecek.")
        .catch(() => {});
    }
  });
}
