# Deploying the server (Oracle Cloud VM)

The backend runs on an Oracle Cloud Always Free VM (Ubuntu 20.04, ARM64) using Docker Compose. There are two containers:

- **server**: the Node API and, later, the hourly worker. The SQLite file is kept on the VM's disk at `~/MyNewsApp/server/data/mynews.db`, mounted into the container at `/data`, so it survives container restarts, rebuilds and VM reboots.
- **caddy**: a reverse proxy on ports 80/443 that gets and renews a Let's Encrypt HTTPS certificate on its own. HTTPS is needed because Android release builds block plain `http://` by default.

The config is in [server/docker-compose.yml](../server/docker-compose.yml), [server/Caddyfile](../server/Caddyfile) and [server/Dockerfile](../server/Dockerfile).

Why this host: it's free, always on (so the hourly job runs with no clients connected), and has a real persistent disk.

## Before you start (on your PC)

- `server/package-lock.json` must exist and be pushed. Create it with `npm install` in `server/`. The Docker build uses `npm ci`, which requires it.
- Commit and push the latest code to GitHub. The VM pulls from `https://github.com/GDeLong33/MyNewsApp` (public).

## One-time VM setup

SSH into the VM as `ubuntu` and run these steps.

### 1. Install Docker, Compose and Buildx

```bash
sudo apt-get update
sudo apt-get install -y docker.io git
sudo systemctl enable --now docker

# Compose v2 and Buildx plugins (Ubuntu 20.04's apt doesn't ship them). ARM64 binaries.
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fSL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-aarch64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo curl -fSL https://github.com/docker/buildx/releases/download/v0.17.1/buildx-v0.17.1.linux-arm64 \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
sudo chmod +x /usr/local/lib/docker/cli-plugins/*

# Run docker without sudo (log out and back in afterwards)
sudo usermod -aG docker ubuntu
```

Log out, SSH back in, and check that both commands print a version:

```bash
docker --version && docker compose version
```

### 2. Open ports 80 and 443

Ports have to be opened in **both** places.

**a. Oracle Cloud console:** go to Networking → Virtual Cloud Networks → your VCN → the instance's subnet → its Security List → Add Ingress Rules. Add two rules:
- Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port `80`
- Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port `443`

(If the instance uses a Network Security Group instead, add the same rules there.)

**b. The VM's firewall.** Oracle's Ubuntu image blocks incoming traffic with iptables rules:

```bash
sudo iptables -I INPUT -p tcp -m state --state NEW --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp -m state --state NEW --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### 3. Choose the hostname

Get the VM's public IP:

```bash
curl -s https://ifconfig.me; echo
```

If you have no domain, use sslip.io, which resolves `<ip-with-dashes>.sslip.io` to that IP. For example, IP `203.0.113.10` becomes `203-0-113-10.sslip.io`. If you have a domain, point an A record at the IP and use that name.

### 4. Get the code and configure it

```bash
git clone https://github.com/GDeLong33/MyNewsApp.git ~/MyNewsApp
cd ~/MyNewsApp/server
cp .env.example .env
nano .env          # set DOMAIN=<your hostname>; later, API keys go here too
chmod 600 .env
```

## Deploy

```bash
cd ~/MyNewsApp/server
docker compose up -d --build
docker compose ps                  # both containers should be "running" / server "healthy"
docker compose logs caddy | tail   # look for "certificate obtained successfully"
```

To redeploy after pushing new code:

```bash
cd ~/MyNewsApp && git pull && cd server && docker compose up -d --build
```

## Verify

1. Check health (from anywhere, including your PC):
   ```bash
   curl https://<DOMAIN>/health
   ```
   Expect `"status":"ok"` with a `bootCount`.

2. Restart the server and check again:
   ```bash
   docker compose restart server
   curl https://<DOMAIN>/health
   ```
   The data has persisted if `bootCount` went up by 1 and `firstBootAt` is unchanged.

3. Optional stronger check: rebuild with `docker compose up -d --build --force-recreate`, or reboot the VM with `sudo reboot`. After it comes back, the containers restart automatically and `bootCount` keeps climbing.

## Useful commands

- `docker compose logs -f server`: live server logs
- `docker compose ps`: container status and health
- `ls -la ~/MyNewsApp/server/data`: the SQLite files
- Back up the database: `cp ~/MyNewsApp/server/data/mynews.db ~/mynews-backup-$(date +%F).db`

## Troubleshooting

- **`curl` times out:** a port is still closed. Check both the Oracle security list and the iptables rules (step 2).
- **Caddy can't get a certificate:** port 80 must be reachable from the internet for the Let's Encrypt challenge, and DOMAIN must resolve to this VM's IP.
- **`npm ci` fails during the build:** `package-lock.json` is missing or out of date in the pushed code.
