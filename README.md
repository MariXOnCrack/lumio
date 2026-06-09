# Lumio

Lumio is a React streaming-service frontend with a small Node server for Docker deployment and Jellyfin login/configuration.

## Docker Compose

1. Create your local env file:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Optional: set `JELLYFIN_SERVER_URL` in `.env`.

   If Jellyfin is in the same Docker network and its service name is `jellyfin`, use:

   ```env
   JELLYFIN_SERVER_URL=http://jellyfin:8096
   ```

   If this is left empty, Lumio opens a first-launch setup page where the Jellyfin URL can be entered.

3. Start Lumio:

   ```powershell
   docker compose up -d --build
   ```

4. Open Lumio:

   ```text
   http://localhost:3000
   ```

## Jellyfin Admin Settings

After the first setup, changing the Jellyfin server URL requires a Jellyfin admin account. Admin users see a `Jellyfin` panel in Lumio where the server URL can be changed. The value is stored in the `lumio_config` Docker volume at `/app/config/lumio-config.json`.

## Local Production Run

```powershell
npm run build
npm start
```
