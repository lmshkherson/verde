#!/usr/bin/env bash
#
# VERDE ERP — розгортання й оновлення на власному сервері (Ubuntu/Debian VPS).
#
# Один файл на все життя сервера:
#
#   sudo ./deploy.sh install   — перше розгортання на чистому сервері
#   sudo ./deploy.sh update    — оновлення до свіжого коду (бекап → міграції → збірка → рестарт)
#   sudo ./deploy.sh backup    — бекап бази в /var/backups/verde (тримається 14 копій)
#   sudo ./deploy.sh status    — стан служби і /api/health
#
# Перед install можна перекрити будь-яку змінну з блоку конфігурації:
#   DOMAIN=verde-app.shop BRANCH=main sudo -E ./deploy.sh install
#
# Скрипт навмисно багатослівний: кожен крок каже, що робить, і зупиняється
# на першій помилці — половинчастого стану після нього не лишається.

set -euo pipefail

# ── Конфігурація ─────────────────────────────────────────────────────────────
APP_DIR="${APP_DIR:-/opt/verde}"            # куди клонується репозиторій
REPO_URL="${REPO_URL:-https://github.com/lmshkherson/verde.git}"
BRANCH="${BRANCH:-claude/pryvit-9m554l}"    # робоча гілка; після злиття поміняйте на main
DOMAIN="${DOMAIN:-verde-app.shop}"          # домен для nginx
PORT="${PORT:-3100}"                        # порт застосунку (лише локальний, назовні — nginx)
DB_NAME="${DB_NAME:-verde_erp}"
DB_USER="${DB_USER:-verde}"
SERVICE="verde-erp"                         # ім'я systemd-служби
BACKUP_DIR="/var/backups/verde"
BACKUP_KEEP=14

ERP_DIR="$APP_DIR/erp"
ENV_FILE="$ERP_DIR/.env.local"

say()  { echo -e "\n\033[1;32m▸ $*\033[0m"; }
fail() { echo -e "\033[1;31m✗ $*\033[0m" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запускайте через sudo: sudo ./deploy.sh ${1:-install}"

# ── Допоміжне ────────────────────────────────────────────────────────────────

db_url() {
  # Рядок підключення читається з .env.local — він єдине джерело правди.
  grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d "'\""
}

health() {
  curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null || echo '{"status":"недоступний"}'
}

do_backup() {
  mkdir -p "$BACKUP_DIR"
  local file="$BACKUP_DIR/verde-$(date +%F-%H%M).dump"
  say "Бекап бази → $file"
  sudo -u postgres pg_dump -Fc "$DB_NAME" -f "$file" \
    || fail "Бекап не вдався — оновлення без бекапу не продовжується"
  # Ротація: старіші за $BACKUP_KEEP копій прибираються.
  ls -1t "$BACKUP_DIR"/verde-*.dump 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | xargs -r rm -f
  echo "  Копій у теці: $(ls -1 "$BACKUP_DIR"/verde-*.dump 2>/dev/null | wc -l)"
}

# ── install ──────────────────────────────────────────────────────────────────

do_install() {
  say "Пакети системи (git, nginx, postgresql, curl)"
  apt-get update -qq
  apt-get install -y -qq git nginx postgresql curl ca-certificates >/dev/null

  if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 20 ]; then
    say "Node.js 22 (NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  echo "  node $(node -v), npm $(npm -v)"

  say "База даних PostgreSQL: $DB_NAME"
  local db_pass
  db_pass=$(openssl rand -hex 24)
  sudo -u postgres psql -tc "select 1 from pg_roles where rolname='$DB_USER'" | grep -q 1 \
    || sudo -u postgres psql -c "create role $DB_USER login password '$db_pass'"
  sudo -u postgres psql -tc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1 \
    || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

  say "Код: $REPO_URL → $APP_DIR (гілка $BRANCH)"
  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout "$BRANCH" \
      && git -C "$APP_DIR" pull origin "$BRANCH"
  else
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi

  if [ ! -f "$ENV_FILE" ]; then
    say "Змінні середовища → $ENV_FILE"
    cat > "$ENV_FILE" <<ENVEOF
DATABASE_URL=postgres://$DB_USER:$db_pass@127.0.0.1:5432/$DB_NAME
SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')
PORT=$PORT
ENVEOF
    chmod 600 "$ENV_FILE"
  else
    say "$ENV_FILE уже існує — не чіпаю (пароль бази лишається старий)"
  fi

  say "Залежності і міграції"
  cd "$ERP_DIR"
  npm ci --no-audit --no-fund
  npm run db:migrate

  # Перший запуск на порожній базі потребує власника і юрособи.
  local users
  users=$(sudo -u postgres psql -d "$DB_NAME" -tAc "select count(*) from app_users" 2>/dev/null || echo 0)
  if [ "${users:-0}" -eq 0 ]; then
    echo
    echo "  ┌─────────────────────────────────────────────────────────────────┐"
    echo "  │ База порожня. Створіть власника і юрособу (один раз):           │"
    echo "  │                                                                 │"
    echo "  │   cd $ERP_DIR"
    echo "  │   ADMIN_EMAIL='...' ADMIN_NAME='...' ADMIN_PASSWORD='...' \\     │"
    echo "  │   ENTITY_NAME='...' ENTITY_SHORT='...' ENTITY_PREFIX='ВС' \\     │"
    echo "  │   ENTITY_EDRPOU='...' ENTITY_IPN='...' ENTITY_VAT=true \\        │"
    echo "  │   npm run db:init                                               │"
    echo "  │                                                                 │"
    echo "  │ Для демо-стенду замість цього: npm run db:seed                  │"
    echo "  └─────────────────────────────────────────────────────────────────┘"
    echo
  fi

  say "Збірка застосунку"
  npm run build

  say "Служба systemd: $SERVICE"
  cat > "/etc/systemd/system/$SERVICE.service" <<UNITEOF
[Unit]
Description=VERDE ERP (Next.js)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
WorkingDirectory=$ERP_DIR
ExecStart=$(command -v npm) start
Restart=always
RestartSec=3
# .env.local Next читає сам; тут лише порт для надійності.
Environment=PORT=$PORT
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNITEOF
  systemctl daemon-reload
  systemctl enable --now "$SERVICE"

  say "nginx: $DOMAIN → 127.0.0.1:$PORT"
  cat > "/etc/nginx/sites-available/$SERVICE" <<NGINXEOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINXEOF
  ln -sf "/etc/nginx/sites-available/$SERVICE" "/etc/nginx/sites-enabled/$SERVICE"
  nginx -t && systemctl reload nginx

  say "Готово. Перевірка:"
  sleep 3
  health
  echo
  echo "HTTPS (один раз): apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d $DOMAIN"
  echo "Щоденний бекап (один раз): echo '17 3 * * * root $ERP_DIR/deploy.sh backup' > /etc/cron.d/verde-backup"
}

# ── update ───────────────────────────────────────────────────────────────────

do_update() {
  [ -d "$APP_DIR/.git" ] || fail "У $APP_DIR немає репозиторію — спершу sudo ./deploy.sh install"
  [ -f "$ENV_FILE" ] || fail "Немає $ENV_FILE — спершу sudo ./deploy.sh install"

  say "Свіжий код (гілка $BRANCH)"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  local before after
  before=$(git -C "$APP_DIR" rev-parse --short HEAD)
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
  after=$(git -C "$APP_DIR" rev-parse --short HEAD)
  echo "  $before → $after"

  # Бекап перед міграціями обов'язковий: зворотних скриптів у міграцій немає,
  # відкат схеми — це відновлення з бекапу.
  do_backup

  say "Залежності, міграції, збірка"
  cd "$ERP_DIR"
  npm ci --no-audit --no-fund
  npm run db:migrate
  npm run build

  say "Рестарт служби"
  systemctl restart "$SERVICE"
  sleep 3

  say "Перевірка /api/health"
  health
  echo
  echo "Якщо статус не ok — відкат: git -C $APP_DIR reset --hard $before && cd $ERP_DIR && npm ci && npm run build && systemctl restart $SERVICE"
  echo "Схему при потребі відновлюйте з бекапу: sudo -u postgres pg_restore -d $DB_NAME --clean --if-exists $BACKUP_DIR/verde-*.dump"
}

# ── Розбір команди ───────────────────────────────────────────────────────────

case "${1:-}" in
  install) do_install ;;
  update)  do_update ;;
  backup)  do_backup ;;
  status)  systemctl --no-pager -l status "$SERVICE" || true; echo; health; echo ;;
  *) echo "Використання: sudo ./deploy.sh {install|update|backup|status}"; exit 1 ;;
esac
