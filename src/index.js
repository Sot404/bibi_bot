import "dotenv/config";
import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { DateTime } from "luxon";
import { createClient } from "@supabase/supabase-js";
import {
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} from "discord.js";

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.GUILD_ID;
const channelId = process.env.CHANNEL_ID;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appId = process.env.DISCORD_APP_ID;
const appBaseUrl = process.env.APP_BASE_URL;

if (!token || !guildId || !channelId) {
  console.error("Missing env vars. Please set DISCORD_BOT_TOKEN, GUILD_ID, CHANNEL_ID in .env");
  process.exit(1);
}

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("Supabase env vars missing. Bot data features will be disabled.");
}

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
    : null;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.join(__dirname, "..", "web");

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

// Web service HTTP server (Render Web Service)
const port = process.env.PORT || 8080;
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === "/config.js") {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(
          `window.__SUPABASE_URL__=${JSON.stringify(process.env.SUPABASE_URL || "")};` +
            `window.__SUPABASE_ANON_KEY__=${JSON.stringify(
              process.env.SUPABASE_ANON_KEY || ""
            )};`
        );
        return;
      }
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok\n");
        return;
      }

      let reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
      if (reqPath === "/planner") reqPath = "/index.html";

      const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
      const filePath = path.join(webRoot, safePath);

      if (!filePath.startsWith(webRoot)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      const data = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      res.end(data);
    } catch (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  })
  .listen(port, () => {
    console.log(`HTTP server listening on port ${port}`);
  });

// Slash commands
async function registerCommands() {
  if (!appId || !guildId) {
    console.warn("Missing DISCORD_APP_ID or GUILD_ID, slash commands not registered.");
    return;
  }

  const commands = [
    new SlashCommandBuilder().setName("plan").setDescription("Άνοιξε τον planner"),
    new SlashCommandBuilder()
      .setName("program")
      .setDescription("Δείξε το πρόγραμμα ενός χρήστη")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Ο χρήστης").setRequired(true)
      ),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
  console.log("Slash commands registered.");
}

function parseGifList(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickRandom(list) {
  if (!list.length) return "";
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}

// Configure your GIF URLs here (comma-separated)
const GIFS = {
  online: parseGifList(process.env.GIF_ONLINE),
  minecraftSolo: parseGifList(process.env.GIF_MINECRAFT_SOLO || process.env.GIF_MINECRAFT),
  minecraftGroup: parseGifList(process.env.GIF_MINECRAFT_GROUP || process.env.GIF_MINECRAFT),
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.GuildMember, Partials.User, Partials.Presence],
});

const lastState = new Map();
const lastSent = new Map();
const DEDUPE_MS = 5000;
const minecraftPlayers = new Set();
const lastOfflineAt = new Map();
const lastOnlineNotifyAt = new Map();

const ONLINE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const LONG_OFFLINE_MS = 60 * 60 * 1000; // 60 minutes
const QUIET_HOURS_START = 1; // 01:00
const QUIET_HOURS_END = 10; // 10:00
const ATHENS_TZ = "Europe/Athens";

const WISH_HOUR = 11;
const WISH_MINUTE = 11;
let wishTimer = null;
let wishSafetyTimer = null;
let lastWishDate = null;
let notifyChannel = null;

function isMinecraft(presence) {
  if (!presence || !presence.activities) return false;
  return presence.activities.some((a) => a?.name?.toLowerCase() === "minecraft");
}

function isOnlineStatus(status) {
  return status && status !== "offline" && status !== "invisible";
}

function shouldSend(memberId, key) {
  const now = Date.now();
  const mapKey = `${memberId}:${key}`;
  const last = lastSent.get(mapKey) || 0;
  if (now - last < DEDUPE_MS) return false;
  lastSent.set(mapKey, now);
  return true;
}

function isQuietHours() {
  const hour = DateTime.now().setZone(ATHENS_TZ).hour;
  return hour >= QUIET_HOURS_START && hour < QUIET_HOURS_END;
}

async function tickWish() {
  if (!notifyChannel) return;
  await notifyChannel.send({ content: "11:11 κάνε ευχή!" });
}

function scheduleWish() {
  if (wishTimer) clearTimeout(wishTimer);

  const now = DateTime.now().setZone(ATHENS_TZ);
  const dateKey = now.toISODate();
  const inWishMinute =
    now.hour === WISH_HOUR && now.minute === WISH_MINUTE;

  if (inWishMinute && lastWishDate !== dateKey) {
    lastWishDate = dateKey;
    tickWish().catch((err) => console.error("wish tick error:", err));
  }

  let target = now.set({ hour: WISH_HOUR, minute: WISH_MINUTE, second: 0, millisecond: 0 });
  if (now >= target) target = target.plus({ days: 1 });
  const delayMs = Math.max(0, target.diff(now).as("milliseconds"));

  wishTimer = setTimeout(() => {
    scheduleWish();
  }, delayMs);
}

function buildMentions(guild, excludeIds) {
  const parts = [];
  let length = 0;
  let truncated = false;

  for (const member of guild.members.cache.values()) {
    if (excludeIds.has(member.id)) continue;
    if (member.user.bot) continue;

    const mention = `<@${member.id}>`;
    if (length + mention.length + 1 > 1800) {
      truncated = true;
      break;
    }
    parts.push(mention);
    length += mention.length + 1;
  }

  return { text: parts.join(" "), truncated };
}

async function sendWithGif(channel, content, gifList) {
  const gifUrl = pickRandom(gifList);
  if (!gifUrl) {
    await channel.send({ content });
    return;
  }

  // Use embed so the GIF shows inline when the URL is a direct image link.
  const embed = new EmbedBuilder().setImage(gifUrl);
  await channel.send({ content, embeds: [embed] });
}

async function maybeSend(channel, guild, member, prev, next, minecraftGifList) {
  const minecraftStarted = !prev.minecraft && next.minecraft;
  const onlineStarted = !prev.online && next.online;

  // If Minecraft starts on the same update as coming online, send only the Minecraft message.
  if (minecraftStarted && shouldSend(member.id, "minecraft")) {
    const { text: mentions, truncated } = buildMentions(
      guild,
      new Set([member.id, client.user.id])
    );

    const suffix = truncated ? " και άλλοι" : "";
    const prefix = mentions ? `${mentions}${suffix} ` : "";
    await sendWithGif(
      channel,
      `${prefix}${member.user.tag} παίζει Minecraft!`,
      minecraftGifList
    );
    return;
  }

  if (onlineStarted && shouldSend(member.id, "online")) {
    if (isQuietHours()) return;

    const lastOnline = lastOnlineNotifyAt.get(member.id) || 0;
    if (Date.now() - lastOnline < ONLINE_COOLDOWN_MS) return;

    const lastOff = lastOfflineAt.get(member.id);
    if (lastOff && Date.now() - lastOff < LONG_OFFLINE_MS) return;

    await sendWithGif(channel, `${member.user.tag} είναι online!`, GIFS.online);
    lastOnlineNotifyAt.set(member.id, Date.now());
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands().catch((err) => console.error("registerCommands error:", err));

  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    console.error("Channel not found or not text-based.");
    process.exit(1);
  }
  notifyChannel = channel;

  // Prime state for all members
  const members = await guild.members.fetch();
  for (const member of members.values()) {
    const presence = member.presence;
    const online = isOnlineStatus(presence?.status);
    const minecraft = isMinecraft(presence);
    lastState.set(member.id, { online, minecraft });
    if (minecraft) minecraftPlayers.add(member.id);
    if (!online) lastOfflineAt.set(member.id, Date.now());
  }

  console.log(`Tracking ${members.size} members.`);

  // Schedule the 11:11 wish precisely
  scheduleWish();
  if (wishSafetyTimer) clearInterval(wishSafetyTimer);
  // Safety check to recover from timer drift or missed scheduling
  wishSafetyTimer = setInterval(() => {
    scheduleWish();
  }, 5 * 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "plan") {
    if (!appBaseUrl) {
      await interaction.reply({ content: "Λείπει το APP_BASE_URL.", ephemeral: true });
      return;
    }
    const bannerPath = path.join(webRoot, "banner.png");
    const banner = new AttachmentBuilder(bannerPath, { name: "banner.png" });
    const embed = new EmbedBuilder()
      .setTitle("Bibi Planner")
      .setDescription("Στήσε το πρόγραμμα της μέρας σου σαν παιχνίδι.")
      .setImage("attachment://banner.png");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Πήγαινε στον planner")
        .setStyle(ButtonStyle.Link)
        .setURL(`${appBaseUrl}/planner`)
    );

    await interaction.reply({
      embeds: [embed],
      files: [banner],
      components: [row],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "program") {
    if (!supabase) {
      await interaction.reply({ content: "Supabase δεν είναι ρυθμισμένο.", ephemeral: true });
      return;
    }

    const user = interaction.options.getUser("user", true);
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("discord_id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      await interaction.reply({
        content: "Δεν βρέθηκε λογαριασμός για αυτόν τον χρήστη. Πρέπει να κάνει login στον planner.",
        ephemeral: true,
      });
      return;
    }

    const today = DateTime.now().setZone(ATHENS_TZ).toISODate();
    const { data: schedule, error } = await supabase
      .from("schedules")
      .select("id, schedule_date, tasks:tasks(title,minutes,start_minute)")
      .eq("user_id", profile.user_id)
      .eq("schedule_date", today)
      .maybeSingle();

    if (error || !schedule) {
      await interaction.reply({
        content: "Δεν υπάρχει πρόγραμμα για σήμερα.",
        ephemeral: true,
      });
      return;
    }

    const tasks = (schedule.tasks || []).sort((a, b) => a.start_minute - b.start_minute);
    const lines = tasks.map((t) => {
      const startH = String(Math.floor(t.start_minute / 60)).padStart(2, "0");
      const startM = String(t.start_minute % 60).padStart(2, "0");
      const end = t.start_minute + t.minutes;
      const endH = String(Math.floor(end / 60)).padStart(2, "0");
      const endM = String(end % 60).padStart(2, "0");
      return `• ${startH}:${startM}-${endH}:${endM} — ${t.title}`;
    });

    await interaction.reply({
      content: `Πρόγραμμα για ${user.tag}:\n${lines.join("\n")}`,
      ephemeral: true,
    });
  }
});

client.on("presenceUpdate", async (oldPresence, newPresence) => {
  try {
    const member = newPresence?.member || oldPresence?.member;
    if (!member) return;

    const prev = lastState.get(member.id) || { online: false, minecraft: false };
    const next = {
      online: isOnlineStatus(newPresence?.status),
      minecraft: isMinecraft(newPresence),
    };

    if (prev.online === next.online && prev.minecraft === next.minecraft) {
      return;
    }

    if (!prev.online && !prev.minecraft && !next.online && !next.minecraft) {
      // still offline/invisible with no minecraft; do nothing
      lastState.set(member.id, next);
      return;
    }

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    const othersPlaying = minecraftPlayers.size - (prev.minecraft ? 1 : 0);
    const minecraftGifList =
      othersPlaying === 0 ? GIFS.minecraftSolo : GIFS.minecraftGroup;

    await maybeSend(channel, guild, member, prev, next, minecraftGifList);

    if (prev.online && !next.online) {
      lastOfflineAt.set(member.id, Date.now());
    }

    lastState.set(member.id, next);

    if (!prev.minecraft && next.minecraft) {
      minecraftPlayers.add(member.id);
    } else if (prev.minecraft && !next.minecraft) {
      minecraftPlayers.delete(member.id);
    }
  } catch (err) {
    console.error("presenceUpdate error:", err);
  }
});

client.login(token);
