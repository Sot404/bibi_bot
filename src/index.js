import "dotenv/config";
import http from "http";
import { DateTime } from "luxon";
import { Client, GatewayIntentBits, Partials, EmbedBuilder, Events } from "discord.js";

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.GUILD_ID;
const channelId = process.env.CHANNEL_ID;

if (!token || !guildId || !channelId) {
  console.error("Missing env vars. Please set DISCORD_BOT_TOKEN, GUILD_ID, CHANNEL_ID in .env");
  process.exit(1);
}

// Web service keep-alive endpoint (required by Render Web Service)
const port = process.env.PORT || 8080;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is alive!\n");
  })
  .listen(port, () => {
    console.log(`HTTP server listening on port ${port}`);
  });

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

function shouldSendWish() {
  const now = DateTime.now().setZone(ATHENS_TZ);
  const dateKey = now.toISODate();
  if (now.hour !== WISH_HOUR || now.minute !== WISH_MINUTE) return false;
  if (lastWishDate === dateKey) return false;
  lastWishDate = dateKey;
  return true;
}

async function tickWish() {
  if (!notifyChannel) return;
  if (!shouldSendWish()) return;
  await notifyChannel.send({ content: "11:11 κάνε ευχή!" });
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

  // Check every 30s for the 11:11 wish
  setInterval(() => {
    tickWish().catch((err) => console.error("wish tick error:", err));
  }, 30_000);
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
