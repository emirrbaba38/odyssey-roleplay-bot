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

const topAllCommand = new SlashCommandBuilder()
  .setName("topall")
  .setDescription("Kim kaç ticket kapattı, listeler (Sadece Yönetim Şefi)");

const topResetCommand = new SlashCommandBuilder()
  .setName("topsıfırla")
  .setDescription("Ticket kapatma istatistiklerini sıfırlar (Sadece Yönetim Şefi)");

const kayitCommand = new SlashCommandBuilder()
  .setName("kayıt")
  .setDescription("Bir kullanıcıyı whitelist'e kaydeder (Sadece Yetkili Ekibi)")
  .addUserOption((option) =>
    option.setName("kişi").setDescription("Kayıt edilecek kişi").setRequired(true)
  )
  .addStringOption((option) =>
    option.setName("isim").setDescription("Kişinin ismi").setRequired(true)
  );

const ALL_COMMANDS = [
  pingCommand.toJSON(),
  ticketPanelCommand.toJSON(),
  topAllCommand.toJSON(),
  topResetCommand.toJSON(),
  kayitCommand.toJSON(),
];

/** Sadece tek bir sunucuya komutları kaydeder (bota yeni sunucu eklendiğinde kullanılır). */
export async function registerCommandsForGuild(client: Client, guildId: string): Promise<void> {
  const token = process.env.DISCORD_TOKEN!;
  const rest = new REST({ version: "10" }).setToken(token);
  const clientId = client.application?.id;
  if (!clientId) {
    console.error("Client ID bulunamadı, komutlar kaydedilemedi.");
    return;
  }
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: ALL_COMMANDS });
    console.log(`Sunucu ${guildId} için komutlar kaydedildi.`);
  } catch (err) {
    console.error(`Sunucu ${guildId} için komut kaydı başarısız:`, err);
  }
}

export async function registerCommands(client: Client): Promise<void> {
  const token = process.env.DISCORD_TOKEN!;
  const rest = new REST({ version: "10" }).setToken(token);
  const guilds = client.guilds.cache;

  if (guilds.size === 0) {
    console.log("Hiç sunucu bulunamadı — komutlar kaydedilemedi.");
    return;
  }

  const commands = ALL_COMMANDS;

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
