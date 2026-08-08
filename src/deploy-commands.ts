import { REST, Routes, SlashCommandBuilder } from "discord.js";
import type { Client } from "discord.js";

// Yeni komutlar buraya eklenecek (SlashCommandBuilder ile tanımlanıp, altta
// "commands" dizisine ve index.ts'deki interaction yönlendirmesine eklenmeli).
const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Botun çalışıp çalışmadığını test eder");

const ticketPanelCommand = new SlashCommandBuilder()
  .setName("ticketpanel")
  .setDescription("Bu kanala destek talebi (ticket) panelini gönderir (Sadece Yetkili)");

export async function registerCommands(client: Client): Promise<void> {
  const token = process.env.DISCORD_TOKEN!;
  const rest = new REST({ version: "10" }).setToken(token);
  const guilds = client.guilds.cache;

  if (guilds.size === 0) {
    console.log("Hiç sunucu bulunamadı — komutlar kaydedilemedi.");
    return;
  }

  const commands = [pingCommand.toJSON(), ticketPanelCommand.toJSON()];

  const clientId = client.application?.id;
  if (!clientId) {
    console.error("Client ID bulunamadı, komutlar kaydedilemedi.");
    return;
  }

  for (const guild of guilds.values()) {
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: commands });
      console.log(`"${guild.name}" sunucusuna komutlar kaydedildi.`);
    } catch (err) {
      console.error(`"${guild.name}" sunucusuna komut kaydı başarısız:`, err);
    }
  }
}
