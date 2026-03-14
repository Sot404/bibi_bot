# Presence GIF Bot

Tracks member presence and sends predefined GIFs when:
- a member goes from offline/invisible to online
- a member starts playing Minecraft

## Setup
1. Install Node.js 18+.
2. In Discord Developer Portal, enable:
   - SERVER MEMBERS INTENT
   - PRESENCE INTENT
3. Fill `.env`:
   - `DISCORD_BOT_TOKEN`
   - `GUILD_ID`
   - `CHANNEL_ID`
   - optional `GIF_ONLINE`, `GIF_MINECRAFT`

## Run
```
npm install
npm run start
```

For development with auto-reload:
```
npm run dev
```
