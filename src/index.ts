import { Client, GatewayIntentBits, Events } from "discord.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerCommands, registerCommandsForGuild } from "./deploy-commands.js";
import {
  handleTicketPanelCommand,
  handleTicketCategorySelect,
  handleTicketCloseButton,
  handleTicketClaimButton,
  handleTopAllCommand,
  handleTopResetCommand,
  TICKET_SELECT_ID,
  TICKET_CLOSE_PREFIX,
  TICKET_CLAIM_PREFIX,
} from "./commands/ticket.js";
import { registerAutoRole } from "./events/auto-role.js";
import { registerVoiceWaitingRoom } from "./events/voice-waiting-room.js";
import { registerGreeting } from "./events/greeting.js";
import { registerInviteTracker } from "./events/invite-tracker.js";
import { handleKayitCommand } from "./commands/kayit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ DISCORD_TOKEN ortam değişkeni tanımlı değil.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Giriş yapıldı: ${readyClient.user.tag}`);
  await registerCommands(client);

  try {
    const bannerPath = join(__dirname, "..", "assets", "banner.gif");
    const bannerBuffer = readFileSync(bannerPath);
    await readyClient.user.setBanner(bannerBuffer);
    console.log("🖼️ Bot banner'ı ayarlandı.");
  } catch (err) {
    console.error("⚠️ Banner ayarlanamadı:", err);
  }

  try {
    const avatarPath = join(__dirname, "..", "assets", "avatar.gif");
    const avatarBuffer = readFileSync(avatarPath);
    await readyClient.user.setAvatar(avatarBuffer);
    console.log("🖼️ Bot avatarı ayarlandı.");
  } catch (err) {
    console.error("⚠️ Avatar ayarlanamadı:", err);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`➕ Yeni sunucuya eklendim: "${guild.name}", komutlar kaydediliyor...`);
  await registerCommandsForGuild(client, guild.id);
});

registerAutoRole(client);
registerVoiceWaitingRoom(client);
registerGreeting(client);
registerInviteTracker(client);

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") {
        await interaction.reply("🏓 Pong! Bot çalışıyor.");
      } else if (interaction.commandName === "ticketpanel") {
        await handleTicketPanelCommand(interaction);
      } else if (interaction.commandName === "topall") {
        await handleTopAllCommand(interaction);
      } else if (interaction.commandName === "topsıfırla") {
        await handleTopResetCommand(interaction);
      } else if (interaction.commandName === "kayıt") {
        await handleKayitCommand(interaction);
      }
      // Yeni komutlar buraya "else if" olarak eklenecek.
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === TICKET_SELECT_ID) {
        await handleTicketCategorySelect(interaction);
      }
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith(TICKET_CLAIM_PREFIX)) {
        await handleTicketClaimButton(interaction);
      } else if (interaction.customId.startsWith(TICKET_CLOSE_PREFIX)) {
        await handleTicketCloseButton(interaction);
      }
    }
  } catch (err) {
    console.error("Etkileşim hatası:", err);
    const msg = { content: "❌ Bir hata oluştu.", ephemeral: true };
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
  }
});

// Beklenmeyen hatalarda process'in sessizce çökmesini önle (bot "çevrimdışı" görünmesin diye).
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Yakalanmamış promise hatası:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️ Yakalanmamış istisna:", err);
});

client.login(token).catch((err) => {
  console.error("❌ Bota giriş yapılamadı:", err);
  process.exit(1);
});
