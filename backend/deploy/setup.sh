#!/usr/bin/env bash
# Set up or redeploy the API on a fresh Ubuntu 24.04 server. Safe to re-run.
#
#   sudo bash setup.sh api.example.com    # HTTPS via Caddy (DNS A record must point here)
#   sudo bash setup.sh                    # no domain yet: plain HTTP on port 80, by IP
#
# Secrets: copy backend/.env to /root/iku.env on the server first (never in git). On the first run
# it's installed as /opt/iku/app/backend/.env; later runs keep the existing one unless
# /root/iku.env is newer.
# BRANCH defaults to main; e.g. BRANCH=my-feature to try a branch on the server.
set -euo pipefail

DOMAIN="${1:-}"
BRANCH="${BRANCH:-main}"
REPO="https://github.com/dnagasundhar-png/IKU_Trip_Planner.git"
STAGED_ENV=/root/iku.env
APP=/opt/iku/app
BACKEND=$APP/backend
export DEBIAN_FRONTEND=noninteractive

echo "==> Packages"
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip git ufw curl >/dev/null
if ! command -v caddy >/dev/null; then
  if ! apt-get install -y -qq caddy >/dev/null 2>&1; then
    echo "   caddy not in Ubuntu repos, using Caddy's official repo"
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
fi
caddy version

echo "==> Service user"
id iku >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/iku --shell /usr/sbin/nologin iku

echo "==> Code ($BRANCH)"
if [ -d "$APP/.git" ]; then
  sudo -u iku git -C "$APP" fetch -q origin "$BRANCH"
  sudo -u iku git -C "$APP" checkout -q "$BRANCH"
  sudo -u iku git -C "$APP" reset -q --hard "origin/$BRANCH"
else
  sudo -u iku git clone -q -b "$BRANCH" "$REPO" "$APP"
fi
sudo -u iku git -C "$APP" log --oneline -1

if [ -f "$STAGED_ENV" ] && { [ ! -f "$BACKEND/.env" ] || [ "$STAGED_ENV" -nt "$BACKEND/.env" ]; }; then
  echo "==> Installing secrets from $STAGED_ENV"
  install -m 600 -o iku -g iku "$STAGED_ENV" "$BACKEND/.env"
fi
if [ ! -f "$BACKEND/.env" ]; then
  echo "!! No .env. Copy backend/.env to $STAGED_ENV on this server (see README), then re-run." >&2
  exit 1
fi
chown iku:iku "$BACKEND/.env" && chmod 600 "$BACKEND/.env"

echo "==> Python dependencies"
[ -d "$BACKEND/.venv" ] || sudo -u iku python3 -m venv "$BACKEND/.venv"
sudo -u iku "$BACKEND/.venv/bin/pip" install -q --upgrade pip
sudo -u iku "$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt"

echo "==> Database schema (idempotent)"
(cd "$BACKEND" && sudo -u iku .venv/bin/python apply_schema.py)

echo "==> systemd service"
cp "$BACKEND/deploy/iku-api.service" /etc/systemd/system/iku-api.service
systemctl daemon-reload
systemctl enable -q iku-api
systemctl restart iku-api

echo "==> Caddy"
if [ -n "$DOMAIN" ]; then
  SITE="$DOMAIN"
else
  SITE=":80"
  echo "   (no domain given: serving plain HTTP by IP. Browsers on the HTTPS front end will block this.)"
fi
cat > /etc/caddy/Caddyfile <<EOF
$SITE {
    encode gzip
    reverse_proxy 127.0.0.1:8000
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "==> Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> Health check"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8000/health; then echo; echo "OK"; exit 0; fi
  sleep 1
done
echo "!! API didn't come up. Logs: journalctl -u iku-api -n 50" >&2
exit 1
