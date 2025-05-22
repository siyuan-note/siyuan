# NSWIKI – Discord‑gated SiYuan (Railway)

This fork replaces the static `SIYUAN_AUTH_CODE` model with Discord OAuth2.

## Variables

| Key | Example |
|-----|---------|
| `DISCORD_CLIENT_ID` | 1234567890123 |
| `DISCORD_CLIENT_SECRET` | xxxxxxxxx |
| `DISCORD_CALLBACK_URL` | https://nswiki.up.railway.app/auth/discord/callback |
| `SIYUAN_ACCESS_AUTH_CODE` | 7y0zgpxv555m41t9tkcxajth |
| `PORT` | 6806 (external) |
| `SIYUAN_INTERNAL_PORT` | 6807 (kernel) |
| `TZ` | Asia/Singapore |

## Build & Run locally (optional)

```bash
docker build -t nswiki .
docker run -p 6806:6806 -e DISCORD_CLIENT_ID=... -e DISCORD_CLIENT_SECRET=... nswiki
```

## Deploy to Railway

1. Connect your repo.
2. Paste variables above.
3. Deploy. Railway exposes 6806; Discord login page appears on first hit.
