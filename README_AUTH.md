# NSWIKI – Discord‑gated SiYuan (Updated)

This fork replaces SiYuan’s static `SIYUAN_AUTH_CODE` model with Discord OAuth2
and aligns with new env conventions (`SIYUAN_ACCESS_AUTH_CODE`, `PORT=6806`, `TZ=Asia/Singapore`).

## Build & Run on Railway

1. **Variables** – copy `.env.example`, paste into Railway ↘️ *Variables* tab.
2. **Deploy** – Railway builds the Dockerfile.  
   * Discord gateway listens on **6806** (external).  
   * SiYuan kernel lives on **6807** (internal).  

## File Map

* `Dockerfile` – grabs SiYuan v3.1.30 `.tar.gz`, installs Node 20.  
* `start.sh` – boots kernel (`--port $SIYUAN_INTERNAL_PORT`) then gateway.  
* `discord-auth/server.js` – Express + Passport‑Discord proxy.  
* `.env.example` – definitive list of variables.  

---
