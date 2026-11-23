# Self-host Seijaku

Run Seijaku on your own machine: one container, no outside service. Bun serves the web app, the API and the sync socket; notes and accounts are in SQLite and files are on disk, all under `/data`. For Cloudflare, see [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md).

> The server and web build are tested together. The container, the proxy examples and the platforms below have not been run by the project yet. Reports are welcome.

## Rules that apply everywhere

- **HTTPS and one fixed address.** Passkeys and installing the app need HTTPS (plain `http://localhost` also works). Passkeys stop working if the address changes; the 12-word phrase still works.
- **Run one instance only.** Live sync is held in memory and SQLite is one file. Two copies would not see each other's edits.
- **Keep `/data` on a persistent disk.** Not on a network share: SQLite needs real file locks.
- **The proxy must pass WebSockets** (`/sync` and `/sync/shared/...`) and allow 40 MB requests.
- **Sign-up is open** unless `SETUP_TOKEN` is set.

## Docker Compose

```bash
git clone https://github.com/dedyrahmat/seijaku.git
cd seijaku
```

Create `.env` beside `docker-compose.yml`:

```
SEIJAKU_ORIGIN=https://notes.example.com
SETUP_TOKEN=choose-a-long-code
```

```bash
docker compose up -d --build
curl http://localhost:8791/api/health     # {"ok":true}
```

To try it on your own computer, leave `SEIJAKU_ORIGIN` out and open <http://localhost:8791>.

`docker-compose.yml` publishes port 8791 on every network interface. Behind a proxy on the same machine, keep it private and pass extra settings with `docker-compose.override.yml` (Compose 2.24 or newer):

```yaml
services:
  seijaku:
    ports: !override
      - "127.0.0.1:8791:8791"
    environment:
      QUOTA_FILES_MB: "500"
```

## Plain Docker or Podman

```bash
docker build -t seijaku .
docker run -d --name seijaku --restart unless-stopped \
  -p 127.0.0.1:8791:8791 -v seijaku-data:/data \
  -e SEIJAKU_ORIGIN=https://notes.example.com \
  -e SETUP_TOKEN=choose-a-long-code \
  seijaku
```

With Podman, replace `docker` with `podman` (`docker.io/oven/bun:1` is the base image if it asks), or use `podman compose`.

## HTTPS in front

The server reads the visitor's address from `CF-Connecting-IP`, then `X-Forwarded-For`, to limit sign-in attempts. The proxy must set these itself, or a visitor can fake them.

**Caddy** (gets certificates by itself, passes WebSockets):

```
notes.example.com {
	reverse_proxy 127.0.0.1:8791 {
		header_up -CF-Connecting-IP
	}
}
```

**nginx:**

```nginx
server {
    listen 443 ssl;
    server_name notes.example.com;
    # ssl_certificate and ssl_certificate_key here
    client_max_body_size 40m;

    location / {
        proxy_pass http://127.0.0.1:8791;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header CF-Connecting-IP "";
        proxy_read_timeout 120s;
    }
}
```

The desktop app sends its session token in the socket's address (`/sync?token=...`). Turn off or shorten access logs for `/sync`.

**Cloudflare Tunnel:** point a public hostname at `http://localhost:8791`. Do not remove `CF-Connecting-IP` here.

**Tailscale:** `tailscale serve --bg 8791` gives HTTPS on your private network. Use the `https://...ts.net` address as `SEIJAKU_ORIGIN`.

**Traefik:** route the host to container port 8791; WebSockets work as they are. Remove `CF-Connecting-IP` with a headers middleware.

## Panels and platforms

Each of these can build the `Dockerfile`. Give it a volume at `/data`, container port 8791, one instance and `SEIJAKU_ORIGIN` set to the public HTTPS address.

| Tool                       | Notes                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Coolify, Dokploy, CapRover | Choose the Dockerfile build and add the volume; the panel handles HTTPS                      |
| Portainer                  | Make a stack from `docker-compose.yml`; set the variables in the stack                       |
| Synology, Unraid, CasaOS   | Use the Compose file; put `/data` on a local disk                                            |
| Railway                    | Add a volume at `/data`; set `PORT` to 8791                                                  |
| Render                     | Needs a plan with a persistent disk, mounted at `/data`                                      |
| Fly.io                     | `internal_port = 8791`, a volume at `/data`, one machine                                     |
| Kubernetes                 | One replica, `strategy: Recreate`, a `ReadWriteOnce` volume; allow WebSockets in the ingress |

Hosts that only serve static files or short functions (Vercel, Netlify, GitHub Pages) cannot run the server.

## Without containers

With [Bun](https://bun.sh) installed:

```bash
bun install --frozen-lockfile
bun run --cwd apps/web build
SEIJAKU_ORIGIN=https://notes.example.com SEIJAKU_DB=/var/lib/seijaku/seijaku.sqlite \
  SEIJAKU_BLOBS=/var/lib/seijaku/blobs bun apps/server/src/bun.ts
```

A systemd unit, with the code in `/opt/seijaku`, a `seijaku` user, and the variables above plus `SETUP_TOKEN` in `/etc/seijaku.env` (readable by root only):

```ini
[Unit]
Description=Seijaku
After=network-online.target
Wants=network-online.target

[Service]
User=seijaku
WorkingDirectory=/opt/seijaku
EnvironmentFile=/etc/seijaku.env
ExecStart=/usr/local/bin/bun apps/server/src/bun.ts
StateDirectory=seijaku
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Settings

| Variable                                            | Purpose                                                                                                                                                                                                   | Default                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `SEIJAKU_ORIGIN`                                    | Address(es) people open, comma-separated; the first is the main one                                                                                                                                       | `http://localhost:8791` in Compose |
| `SETUP_TOKEN`                                       | Sign-up code                                                                                                                                                                                              | unset: open sign-up                |
| `PORT`                                              | Port to listen on                                                                                                                                                                                         | `8791`                             |
| `SEIJAKU_DB`                                        | SQLite file                                                                                                                                                                                               | `/data/seijaku.sqlite` in Docker   |
| `SEIJAKU_BLOBS`                                     | Folder for attached files                                                                                                                                                                                 | `/data/blobs` in Docker            |
| `SEIJAKU_WEB`                                       | Folder with the web build                                                                                                                                                                                 | `apps/web/dist`                    |
| `SEIJAKU_RP_ID`                                     | Passkey domain, if it must differ from the address                                                                                                                                                        | host of the first address          |
| `AUTH_SECRET`                                       | Signs sessions, at least 32 characters. Changing it breaks phrase sign-in                                                                                                                                 | made once, kept in the database    |
| `QUOTA_FILES_MB`, `QUOTA_SNAPSHOTS`, `QUOTA_SHARES` | Per-account limits; `0` means no limit. Files, snapshots and published pages share the MB limit                                                                                                           | 500, 5000, 100                     |
| `QUOTA_SYNC_MB`                                     | Limit on the encrypted sync log per account (and per shared page); `0` means no limit                                                                                                                     | 1024                               |
| `SEIJAKU_IP_HEADER`                                 | Header your reverse proxy sets to the client address (for example `x-real-ip`). Unset, no header is believed and sign-in/sign-up limits share one bucket. Set it only if the proxy overwrites that header | unset                              |

The Compose file passes only `SEIJAKU_ORIGIN` and `SETUP_TOKEN`. Add others in the override file.

## Back up and restore

Stop first: SQLite keeps recent changes in a second file, so copying a running database can lose them. Run these from the repository folder.

```bash
docker compose stop
docker run --rm --volumes-from "$(docker compose ps -aq seijaku)" -v "$PWD:/backup" \
  alpine tar czf /backup/seijaku-backup.tgz -C /data .
docker compose start
```

Restore into a new, empty install (this overwrites files in `/data`):

```bash
docker compose up -d --build && docker compose stop
docker run --rm --volumes-from "$(docker compose ps -aq seijaku)" -v "$PWD:/backup" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/seijaku-backup.tgz -C /data"
docker compose start
```

Notes in a backup stay encrypted, but it also holds sign-in sessions and the server secret. Store it privately.

## Update

Back up, then:

```bash
git pull
docker compose up -d --build
```

The database updates itself on start. `docker compose down` keeps your data; **`docker compose down -v` deletes it**.

## If something goes wrong

| What you see               | Likely cause                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Passkey refused            | Not HTTPS, or the address differs from `SEIJAKU_ORIGIN`                                                 |
| "Cannot reach the server"  | The proxy does not pass WebSockets, or the container is down (`docker compose logs seijaku`)            |
| Upload fails (413)         | The proxy's request limit is too small, or the account's file limit is reached                          |
| Everyone shares one limit  | The proxy does not set `X-Forwarded-For`                                                                |
| Notes gone after an update | `/data` was not on a volume. Signed-in devices still hold their notes: export them before anything else |
