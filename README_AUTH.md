# NSWIKI – Discord‑gated SiYuan on Railway

This add‑on swaps SiYuan's static `SIYUAN_AUTH_CODE` model for Discord OAuth2.

## Quick start (Railway)

1. **Fork** this repo (already done).
2. **Fill in environment variables** in Railway ↘️ *Variables* tab. Use `.env.example` as reference.
3. **Deploy**. Railway will build the custom image:
   * SiYuan kernel runs headless on port **6806**.
   * The Node.js proxy (this project) runs on **3000** and is the only exposed port.
4. **Invite collaborators** by sharing the Railway URL. First visit triggers Discord login.

## Developer notes

* `discord-auth/server.js` – Express + Passport‑Discord gateway.
* `start.sh` – Launches SiYuan kernel **and** the Node proxy.
* `Dockerfile` – Installs Node and SiYuan in a single image.
* `railway.json` – Minimal Railway service manifest.

---
