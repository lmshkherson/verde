# Розгортання на сервері

Що потрібно на сервері: **Node.js 20.9+** (краще 22) і npm. Це звичайний
VPS з Linux — shared-хостинг для PHP не підійде.

## Крок 1. Розпакувати й встановити залежності

```bash
unzip avtochehol-site.zip -d /var/www/avtochehol
cd /var/www/avtochehol
npm install
```

## Крок 2. Налаштувати змінні оточення

```bash
cp .env.example .env
nano .env
```

У `.env` обовʼязково змінити:

- `AUTH_SECRET` — довгий випадковий рядок (згенерувати: `openssl rand -base64 32`).
  З дефолтним значенням адмінка вразлива.
- `ADMIN_EMAIL` і `ADMIN_PASSWORD` — ваш логін і пароль для входу в адмінку.
- `DATABASE_URL` — можна лишити SQLite (`file:./dev.db`), для старту цього
  досить. Перехід на Postgres описано в README.md.

## Крок 3. Створити базу й наповнити каталог

```bash
npx prisma migrate deploy   # створює таблиці
npx prisma generate         # генерує клієнт бази
npm run db:seed             # 40 марок, 247 моделей, лінійки, ціни, статті
```

Сід можна запускати лише один раз при першому розгортанні: він очищає
таблиці. Не запускайте його повторно на живому сайті — зітре замовлення.

## Крок 4. Зібрати й запустити

```bash
npm run build
npm start                   # запуститься на http://localhost:3000
```

Щоб сайт працював постійно й піднімався після перезавантаження сервера:

```bash
npm install -g pm2
pm2 start npm --name avtochehol -- start
pm2 save && pm2 startup
```

## Крок 5. Домен і HTTPS

Поставити nginx як реверс-проксі на порт 3000 і випустити сертифікат:

```nginx
server {
    server_name avtochehol.in.ua;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    client_max_body_size 20m;   # завантаження фото в адмінці
}
```

```bash
sudo certbot --nginx -d avtochehol.in.ua
```

`client_max_body_size 20m` важливий: без нього nginx різатиме завантаження
фото готових робіт.

## Крок 6. Після запуску

1. Зайти в адмінку `https://avtochehol.in.ua/admin` — логін з `.env`.
2. Перевірити й виправити ціни лінійок (розділ «Лінійки»).
3. Замінити телефони, адресу й графік у файлі `lib/site.ts`, після цього
   `npm run build` і `pm2 restart avtochehol`.
4. Додати сайт у Google Search Console і Bing Webmaster Tools, надіслати
   `https://avtochehol.in.ua/sitemap.xml`.

## Що бекапити

- `dev.db` — уся база: замовлення, заявки, каталог. Копіювати щодня.
- `public/uploads/` — фото готових робіт.

Простий крон-бекап:

```bash
0 3 * * * cp /var/www/avtochehol/dev.db /root/backups/dev-$(date +\%F).db
```
