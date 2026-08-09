#!/usr/bin/env node
// Довідники VERDE: користувачі, склади, номенклатура, рецептури, контрагенти.
// Скрипт ідемпотентний — повторний запуск нічого не дублює.
import pg from 'pg';
import { hashPassword } from '../lib/password.mjs';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не заданий');
  process.exit(1);
}

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'verde2026';

// Останнє поле — посада за штатним розписом. Роль у системі це права доступу,
// а в первинному документі потрібна саме посада.
const USERS = [
  ['olena@v-verde.ua', 'Олена Ковальчук', 'owner', 'Директор'],
  ['taras@v-verde.ua', 'Тарас Мельник', 'sales', 'Менеджер з продажу'],
  ['iryna@v-verde.ua', 'Ірина Бондаренко', 'production', 'Технолог'],
  ['petro@v-verde.ua', 'Петро Савченко', 'warehouse', 'Комірник'],
];

// Адреса потрібна для ТТН: це пункт навантаження.
const WAREHOUSES = [
  ['SIR', 'Склад сировини', 'raw', 'Україна, 04060, м. Київ, вул. Щусєва, буд. 15'],
  ['GP', 'Склад готової продукції', 'finished', 'Україна, 04060, м. Київ, вул. Щусєва, буд. 15'],
  ['CEH', 'Цех (незавершене)', 'wip', 'Україна, 04060, м. Київ, вул. Щусєва, буд. 15'],
];

// [sku, назва, тип, од., термін днів, мін. залишок, вага г, шт/бокс, ціни..., штрихкод,
//  темп. від °C, темп. до °C]
//
// Увага: ціни зберігаються БЕЗ ПДВ. Роздрібні з лендінгу (25,80 / 35,70 / 49,99)
// поділені на 1,2 — податок додається в документі за ставкою юрособи.
//
// Штрихкоди демонстраційні й навмисно починаються з 29: цей діапазон GS1
// тримає під внутрішнє використання і реальним товарам не видає, тож демо-код
// ніколи не збігнеться з чужим GTIN. Справжні коди приходять із реєстрації
// в GS1 Україна — їх вписують у картку позиції.
//
// Температурний режим — умова перевезення, а не примітка: порушили — товар
// зіпсовано, а довести дотримання можна лише документом. У пакування його
// немає, і це не пропуск: плівці та картону режим не потрібен.
const ITEMS = [
  // Готова продукція — лінійка «Зарядись», 25 г, шоубокс 16 шт, термін 9 місяців.
  ['VRD-Z-PIST', 'Батончик «Зарядись» Фісташка 25 г', 'finished', 'pcs', 270, 800, 25, 16, 21.5, 29.75, 41.66, '2900000000018', 0, 20],
  ['VRD-Z-ARAH', 'Батончик «Зарядись» Арахіс 25 г', 'finished', 'pcs', 270, 800, 25, 16, 21.5, 29.75, 41.66, '2900000000025', 0, 20],
  ['VRD-Z-MIGD', 'Батончик «Зарядись» Мигдаль 25 г', 'finished', 'pcs', 270, 800, 25, 16, 21.5, 29.75, 41.66, '2900000000032', 0, 20],
  ['VRD-Z-KOKO', 'Батончик «Зарядись» Кокос 25 г', 'finished', 'pcs', 270, 800, 25, 16, 21.5, 29.75, 41.66, '2900000000049', 0, 20],
  ['VRD-Z-FUND', 'Батончик «Зарядись» Фундук 25 г', 'finished', 'pcs', 270, 800, 25, 16, 21.5, 29.75, 41.66, '2900000000056', 0, 20],
  ['VRD-COLLAGEN', 'Батончик Collagen 40 г', 'finished', 'pcs', 270, 500, 40, 12, 30.5, 47.0, 65.83, '2900000000063', 0, 20],

  // Сировина
  ['RAW-FINIK', 'Фініки Деглет Нур паста', 'raw', 'kg', 365, 60, null, null, null, null, null, null, 0, 20],
  ['RAW-PIST', 'Ядро фісташки', 'raw', 'kg', 300, 25, null, null, null, null, null, null, 0, 20],
  ['RAW-ARAH', 'Арахіс смажений', 'raw', 'kg', 240, 30, null, null, null, null, null, null, 0, 20],
  ['RAW-MIGD', 'Мигдаль ядро', 'raw', 'kg', 300, 25, null, null, null, null, null, null, 0, 20],
  ['RAW-KOKO', 'Кокосова стружка', 'raw', 'kg', 300, 20, null, null, null, null, null, null, 0, 20],
  ['RAW-FUND', 'Фундук ядро', 'raw', 'kg', 300, 20, null, null, null, null, null, null, 0, 20],
  ['RAW-KAKAO', 'Какао терте', 'raw', 'kg', 365, 15, null, null, null, null, null, null, 0, 20],
  ['RAW-OLIA', 'Олія кокосова', 'raw', 'kg', 365, 15, null, null, null, null, null, null, 0, 25],
  ['RAW-CYKOR', 'Сироп цикорію', 'raw', 'kg', 365, 25, null, null, null, null, null, null, 0, 20],
  ['RAW-PROTEIN', 'Ізолят горохового білка', 'raw', 'kg', 365, 20, null, null, null, null, null, null, 0, 20],
  ['RAW-COLLAG', 'Колаген пептиди', 'raw', 'kg', 545, 8, null, null, null, null, null, null, 0, 20],
  ['RAW-VITC', 'Премікс вітамін C', 'raw', 'kg', 545, 3, null, null, null, null, null, null, 0, 20],
  ['RAW-VITD3', 'Премікс вітамін D3', 'raw', 'kg', 545, 2, null, null, null, null, null, null, 0, 20],
  ['RAW-VITB12', 'Премікс вітамін B12', 'raw', 'kg', 545, 2, null, null, null, null, null, null, 0, 20],
  ['RAW-GUARANA', 'Екстракт гуарани', 'raw', 'kg', 545, 2, null, null, null, null, null, null, 0, 20],
  ['RAW-MAGNIY', 'Магній цитрат', 'raw', 'kg', 545, 3, null, null, null, null, null, null, 0, 20],
  ['RAW-OMEGA', 'Омега-3 порошок', 'raw', 'kg', 365, 3, null, null, null, null, null, null, 0, 20],

  // Пакування
  ['PAK-FLOW', 'Плівка флоу-пак', 'packaging', 'pcs', null, 20000, null, null, null, null, null, null, null, null],
  ['PAK-BOX', 'Шоубокс картонний', 'packaging', 'pcs', null, 1200, null, null, null, null, null, null, null, null],
  ['PAK-ETIK', 'Етикетка самоклейна', 'packaging', 'pcs', null, 20000, null, null, null, null, null, null, null, null],
];

// Рецептури на 1000 батончиків по 25 г: [sku сировини, кг на варку, % втрат]
const BASE_25 = [
  ['RAW-FINIK', 11, 2],
  ['RAW-PROTEIN', 3, 1],
  ['RAW-OLIA', 2, 1],
  ['RAW-CYKOR', 3.5, 1],
  ['RAW-VITC', 0.15, 0],
  ['PAK-FLOW', 1000, 1],
  ['PAK-ETIK', 1000, 1],
  ['PAK-BOX', 63, 0],
];

const RECIPES = [
  {
    product: 'VRD-Z-PIST',
    output: 1000,
    notes: 'Фісташка + омега-3. Темперування маси 26–28 °C, витримка 40 хв.',
    lines: [...BASE_25, ['RAW-PIST', 5, 2], ['RAW-OMEGA', 0.35, 0]],
  },
  {
    product: 'VRD-Z-ARAH',
    output: 1000,
    notes: 'Арахіс + гуарана 30 мг на батончик.',
    lines: [...BASE_25, ['RAW-ARAH', 5, 2], ['RAW-GUARANA', 0.03, 0]],
  },
  {
    product: 'VRD-Z-MIGD',
    output: 1000,
    notes: 'Мигдаль + вітамін D3.',
    lines: [...BASE_25, ['RAW-MIGD', 5, 2], ['RAW-VITD3', 0.02, 0]],
  },
  {
    product: 'VRD-Z-KOKO',
    output: 1000,
    notes: 'Кокос + магній цитрат.',
    lines: [...BASE_25, ['RAW-KOKO', 5, 3], ['RAW-MAGNIY', 0.25, 0]],
  },
  {
    product: 'VRD-Z-FUND',
    output: 1000,
    notes: 'Фундук + вітамін B12, глазур какао.',
    lines: [...BASE_25, ['RAW-FUND', 4.5, 2], ['RAW-KAKAO', 0.5, 1], ['RAW-VITB12', 0.02, 0]],
  },
  {
    product: 'VRD-COLLAGEN',
    output: 500,
    notes: 'Колагенова лінійка, 40 г. Вихід — 500 шт із варки.',
    lines: [
      ['RAW-FINIK', 8, 2],
      ['RAW-MIGD', 4, 2],
      ['RAW-COLLAG', 3, 1],
      ['RAW-KAKAO', 2, 1],
      ['RAW-OLIA', 1.5, 1],
      ['RAW-CYKOR', 1.5, 1],
      ['RAW-VITC', 0.1, 0],
      ['PAK-FLOW', 500, 1],
      ['PAK-ETIK', 500, 1],
      ['PAK-BOX', 42, 0],
    ],
  },
];

// Дві юрособи з різним податковим статусом — саме та конфігурація, у якій
// одна партія має різну собівартість залежно від власника.
//
// Перша — справжня: реквізити взяті з виписки ЄДР і витягу з реєстру платників
// ПДВ (форма 2-ВР № 2526574500757), бо саме вона друкується на накладних.
// Друга — умовна, для перевірки продажів між своїми.
const ENTITIES = [
  {
    name: 'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ «ВЕРДЕ СВІТ»',
    short: 'Верде Світ',
    edrpou: '45014741',
    ipn: '450147426573',
    prefix: 'ВС',
    tax: 'general',
    vat: true,
    isDefault: true,
    address: 'Україна, 04060, м. Київ, вул. Щусєва, буд. 15, кв. 2',
    phone: '+380675703737',
    email: 'verde.svit@gmail.com',
    director: 'Проніна Аліса Сергіївна',
    directorPosition: 'Директор',
  },
  {
    name: 'ФОП Ковальчук О.М.',
    short: 'Верде Роздріб',
    edrpou: '3184507621',
    ipn: null,
    prefix: 'ВР',
    tax: 'single_tax',
    vat: false,
    isDefault: false,
    address: 'Україна, 04070, м. Київ, вул. Набережно-Хрещатицька, буд. 3',
    phone: '+380671234000',
    email: 'rozdrib@v-verde.ua',
    director: 'Ковальчук Олена Миколаївна',
    directorPosition: 'Фізична особа-підприємець',
  },
];

// Чи є постачальник платником ПДВ (горіхи беремо у ФОП без ПДВ, тож із його
// ціни податкового кредиту не буде навіть у ТОВ), юридична адреса, адреса
// складу — звідки забираємо й куди повертаємо брак — та IBAN.
const SUPPLIERS = [
  ['ТОВ «Сухофрукт Трейд»', '38271940', 'Андрій Кравець', '+380671112233', 14, true,
   '03150, м. Київ, вул. Ділова, буд. 5',
   '08130, Київська обл., с. Петропавлівська Борщагівка, вул. Логістична, буд. 3',
   'UA903052990000026007018811777', 'АТ КБ «ПриватБанк»'],
  ['ФОП Гриценко О.П. (горіхи)', '3012345678', 'Оксана Гриценко', '+380502223344', 7, false,
   '79000, м. Львів, вул. Городоцька, буд. 120', null,
   'UA173220010000026007300012345', 'АТ «Універсал Банк»'],
  ['ТОВ «Нутрі Інгредієнтс»', '41902847', 'Сергій Лисенко', '+380443334455', 30, true,
   '04116, м. Київ, вул. Старокиївська, буд. 10', null,
   'UA383006140000026007700099887', 'АТ «Райффайзен Банк»'],
  ['ТОВ «ПакЛайн Україна»', '39284710', 'Марина Дудник', '+380445556677', 21, true,
   '02160, м. Київ, просп. Соборності, буд. 15', null,
   'UA623052990000026001234509876', 'АТ КБ «ПриватБанк»'],
];

// Останні поля: ІПН платника ПДВ, чи є покупець платником, юридична адреса,
// адреса доставки (у мереж це розподільчий центр, а не юридична) та IBAN —
// за ним платіж із виписки впізнається навіть без ЄДРПОУ в рядку.
const CUSTOMERS = [
  ['ТОВ «АТБ-Маркет»', 'network', '30487219', 'Ігор Панченко', '+380563334455', 'network', 45, 500000, '304872104871', true, '49000, м. Дніпро, вул. Курчатова, буд. 1Б', '52005, Дніпропетровська обл., смт Слобожанське, РЦ «АТБ», вул. Нова, буд. 1', 'UA213052990000026007233566001', 'АТ КБ «ПриватБанк»'],
  ['ТОВ «Фора»', 'network', '31859472', 'Наталія Гунько', '+380442223311', 'network', 30, 300000, '318594726543', true, '02090, м. Київ, вул. Празька, буд. 5', '08132, Київська обл., м. Вишневе, РЦ «Фора», вул. Промислова, буд. 4', 'UA523006140000026001111222333', 'АТ «Райффайзен Банк»'],
  ['ТОВ «Здоров’я Дистрибʼюшн»', 'distributor', '40218374', 'Дмитро Сич', '+380671234567', 'distributor', 14, 200000, '402183712345', true, '01033, м. Київ, вул. Саксаганського, буд. 41', null, 'UA733052990000026005044556677', 'АТ КБ «ПриватБанк»'],
  ['Аптека «Бажаємо здоровʼя»', 'pharmacy', '39471028', 'Леся Ткач', '+380509876543', 'distributor', 7, 50000, '394710298765', true, '79000, м. Львів, просп. Свободи, буд. 12', null, 'UA443220010000026008899001122', 'АТ «Універсал Банк»'],
  ['Мережа кав’ярень «Ранок»', 'horeca', '42917583', 'Богдан Мороз', '+380931112244', 'rrp', 0, 20000, null, false, '61000, м. Харків, вул. Сумська, буд. 25', null, null, null],
  // Власна роздрібна юрособа — продажі їй є реалізацією між своїми.
  ['ФОП Ковальчук О.М. (наша роздрібна)', 'distributor', '3184507621', 'Олена Ковальчук', '+380671234000', 'distributor', 0, 0, null, false, '04070, м. Київ, вул. Набережно-Хрещатицька, буд. 3', null, null, null],
];


// План HACCP: критичні контрольні точки й програми-передумови. Порожні межі
// означають якісний контроль — «відповідає / ні». Гранична пауза — скільки
// годин допустимо без запису: за нею видно, що журнал перестали вести.
// [код, назва, тип, етап, показник, од., від, до, періодичність, пауза год,
//  моніторинг, дія при відхиленні, перевірка, автоджерело]
const HACCP_POINTS = [
  ['ПРП-1', 'Приймання сировини', 'prp', 'receiving', 'Температура при розвантаженні', '°C', 0, 25,
   'кожна поставка', 48,
   'Термощуп у товщу продукту, звірка з документами постачальника',
   'Не приймати; зафіксувати в акті вхідного контролю; повернути постачальнику',
   'Щоквартальна перевірка термощупа', 'incoming'],
  ['ККТ-1', 'Металодетектування', 'ccp', 'production', 'Виявлення сторонніх включень', null, null, null,
   'кожна партія', 24,
   'Пропуск 100% продукції; перевірка тест-зразками Fe 2,0 / non-Fe 2,5 / SS 3,0 мм',
   'Затримати партію від останньої успішної перевірки, перепустити, викликати техніка',
   'Тест-зразки на початку й у кінці зміни', null],
  ['ККТ-2', 'Зберігання сировини', 'ccp', 'storage', 'Температура складу сировини', '°C', 0, 20,
   'двічі на зміну', 12,
   'Реєстратор температури + контрольний термометр',
   'Оцінити придатність партій, перевести в карантин, викликати сервіс холодильного обладнання',
   'Щорічна повірка реєстратора', null],
  ['ККТ-3', 'Зберігання готової продукції', 'ccp', 'storage', 'Температура складу ГП', '°C', 0, 20,
   'двічі на зміну', 12,
   'Реєстратор температури на складі ГП',
   'Оцінити придатність, ізолювати партію, повідомити технолога',
   'Щорічна повірка реєстратора', null],
  ['ПРП-2', 'Пакування', 'prp', 'packaging', 'Цілісність зварного шва', null, null, null,
   'щогодини', 4,
   'Візуальний контроль шва й маркування дати на 5 пачках',
   'Відбракувати продукцію від попередньої перевірки, відрегулювати зварювальні губки',
   'Перевірка герметичності раз на зміну', null],
  ['ПРП-3', 'Відвантаження', 'prp', 'shipping', 'Температура в кузові при завантаженні', '°C', 0, 20,
   'кожен рейс', 72,
   'Замір термощупом до завантаження, запис у ТТН',
   'Не завантажувати; замінити транспорт',
   'Звірка із записами перевізника', 'shipping'],
  ['ПРП-4', 'Санітарна обробка', 'prp', 'production', 'Стан обладнання після мийки', null, null, null,
   'щозміни', 24,
   'Візуальний контроль, змиви за графіком',
   'Повторна мийка, зупинка лінії до результату',
   'Лабораторні змиви раз на місяць', null],
];


// Поживний склад сировини на 100 г і алергени.
// [sku, назва для складу, ккал, білки, жири, насичені, вуглеводи, цукри,
//  спирти, волокна, сіль, алергени]
//
// УВАГА: значення тут ДЕМОНСТРАЦІЙНІ, узяті з довідників харчового складу.
// Для етикетки їх треба замінити на дані зі специфікацій ваших постачальників
// або протоколів досліджень — саме тому в картці позиції є поле «Джерело
// даних». Вуглеводи вказані без харчових волокон, як і в таблиці на етикетці.
const NUTRITION = [
  ['RAW-FINIK',   'паста фінікова',                282, 2.5, 0.4, 0.03, 67,  63,  0, 8,    0.005, []],
  ['RAW-PIST',    'фісташка',                      560, 20,  45,  5.6,  17,  7.7, 0, 10.6, 0.003, ['nuts']],
  ['RAW-ARAH',    'арахіс смажений',               587, 26,  49,  7,    13,  4,   0, 8,    0.01,  ['peanuts']],
  ['RAW-MIGD',    'мигдаль',                       579, 21,  50,  3.8,  9.1, 4.4, 0, 12.5, 0.001, ['nuts']],
  ['RAW-KOKO',    'кокосова стружка',              660, 6.9, 65,  57,   8,   7.4, 0, 16,   0.04,  []],
  ['RAW-FUND',    'фундук',                        628, 15,  61,  4.5,  7,   4.3, 0, 9.7,  0.001, ['nuts']],
  ['RAW-KAKAO',   'какао терте',                   600, 13,  52,  32,   6,   1,   0, 30,   0.02,  []],
  ['RAW-OLIA',    'олія кокосова',                 892, 0,   99,  87,   0,   0,   0, 0,    0,     []],
  ['RAW-CYKOR',   'сироп цикорію (інулін)',        205, 0.5, 0.1, 0,    12,  8,   0, 65,   0.05,  []],
  ['RAW-PROTEIN', 'білок гороховий',               380, 85,  5,   0.8,  2,   0.5, 0, 3,    2.5,   []],
  ['RAW-COLLAG',  'колаген пептиди',               360, 90,  0,   0,    0,   0,   0, 0,    0.5,   []],
  ['RAW-VITC',    'вітамін C',                     330, 0,   0,   0,    90,  0,   0, 0,    0,     []],
  ['RAW-VITD3',   'вітамін D3',                    380, 0,   5,   3,    80,  0,   0, 0,    0,     []],
  ['RAW-VITB12',  'вітамін B12',                   350, 0,   0,   0,    90,  0,   0, 0,    0,     []],
  ['RAW-GUARANA', 'екстракт гуарани',              320, 5,   1,   0.2,  60,  2,   0, 20,   0.01,  []],
  ['RAW-MAGNIY',  'магній цитрат',                 0,   0,   0,   0,    0,   0,   0, 0,    0,     []],
  ['RAW-OMEGA',   'омега-3 (порошок олії водоростей)', 450, 12, 40, 5,  10,  2,   0, 0,    0.3,   []],
];

const client = new pg.Client({
  connectionString,
  ssl: /supabase|amazonaws|render|neon/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

try {
  await client.query('begin');

  // Юрособа, створена міграцією з settings, стає основною виробничою.
  await client.query(
    `update legal_entities
        set name = $1, short_name = $2, doc_prefix = $5,
            edrpou = $3, ipn = $4, tax_system = 'general', is_vat_payer = true
      where short_name = 'VERDE'
        and not exists (select 1 from legal_entities where lower(short_name) = lower($2))`,
    [ENTITIES[0].name, ENTITIES[0].short, ENTITIES[0].edrpou, ENTITIES[0].ipn, ENTITIES[0].prefix],
  );

  for (const e of ENTITIES) {
    await client.query(
      `insert into legal_entities
         (name, short_name, doc_prefix, edrpou, ipn, tax_system, is_vat_payer, is_default,
          address, phone, email, director_name, director_position)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (lower(short_name)) do update
         set name = excluded.name, doc_prefix = excluded.doc_prefix,
             edrpou = excluded.edrpou, ipn = excluded.ipn,
             tax_system = excluded.tax_system, is_vat_payer = excluded.is_vat_payer,
             address = excluded.address, phone = excluded.phone, email = excluded.email,
             director_name = excluded.director_name,
             director_position = excluded.director_position`,
      [
        e.name, e.short, e.prefix, e.edrpou, e.ipn, e.tax, e.vat, e.isDefault,
        e.address, e.phone, e.email, e.director, e.directorPosition,
      ],
    );
  }

  for (const [email, name, role, position] of USERS) {
    await client.query(
      `insert into app_users (email, full_name, role, password_hash, is_demo, position)
       values ($1, $2, $3, $4, true, $5)
       on conflict (lower(email)) do update
         set full_name = excluded.full_name, role = excluded.role, is_demo = true,
             position = excluded.position`,
      [email, name, role, await hashPassword(DEMO_PASSWORD), position],
    );
  }

  await client.query(
    `update app_users set default_entity_id = (select id from legal_entities where is_default)
      where default_entity_id is null`,
  );

  for (const [code, name, kind, address] of WAREHOUSES) {
    await client.query(
      `insert into warehouses (code, name, kind, address) values ($1, $2, $3, $4)
       on conflict (code) do update set name = excluded.name, address = excluded.address`,
      [code, name, kind, address],
    );
  }

  for (const [sku, name, kind, unit, shelf, min, weight, box, pd, pn, prrp, barcode, tMin, tMax] of ITEMS) {
    await client.query(
      `insert into items (sku, name, kind, unit, shelf_life_days, min_stock, weight_g, pcs_per_box,
                          price_distributor, price_network, price_rrp, barcode, temp_min_c, temp_max_c)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (sku) do update set
         name = excluded.name, min_stock = excluded.min_stock,
         price_distributor = excluded.price_distributor,
         price_network = excluded.price_network,
         price_rrp = excluded.price_rrp,
         barcode = excluded.barcode,
         temp_min_c = excluded.temp_min_c, temp_max_c = excluded.temp_max_c`,
      [sku, name, kind, unit, shelf, min, weight, box, pd, pn, prrp, barcode, tMin, tMax],
    );
  }

  for (const recipe of RECIPES) {
    const { rows: exists } = await client.query(
      `select r.id from recipes r join items i on i.id = r.product_item_id where i.sku = $1`,
      [recipe.product],
    );

    let recipeId = exists[0]?.id;
    if (!recipeId) {
      const { rows } = await client.query(
        `insert into recipes (product_item_id, version, output_qty, notes)
         values ((select id from items where sku = $1), 1, $2, $3) returning id`,
        [recipe.product, recipe.output, recipe.notes],
      );
      recipeId = rows[0].id;
    }

    for (const [sku, qty, loss] of recipe.lines) {
      await client.query(
        `insert into recipe_lines (recipe_id, item_id, qty_per_batch, loss_pct)
         values ($1, (select id from items where sku = $2), $3, $4)
         on conflict (recipe_id, item_id) do update
           set qty_per_batch = excluded.qty_per_batch, loss_pct = excluded.loss_pct`,
        [recipeId, sku, qty, loss],
      );
    }
  }

  for (const [name, edrpou, contact, phone, terms, isVat, address, warehouse, iban, bank]
       of SUPPLIERS) {
    const { rows } = await client.query('select id from suppliers where name = $1', [name]);
    if (rows.length === 0) {
      await client.query(
        `insert into suppliers (name, edrpou, contact, phone, payment_terms_days, is_vat_payer,
                                address, warehouse_address, iban, bank_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [name, edrpou, contact, phone, terms, isVat, address, warehouse, iban, bank],
      );
    } else {
      await client.query(
        `update suppliers set is_vat_payer = $2, address = $3, warehouse_address = $4,
                              iban = $5, bank_name = $6
          where id = $1`,
        [rows[0].id, isVat, address, warehouse, iban, bank],
      );
    }
  }

  for (const [name, kind, edrpou, contact, phone, level, terms, limit, ipn, isVat, address,
              delivery, iban, bank] of CUSTOMERS) {
    const { rows } = await client.query('select id from customers where name = $1', [name]);
    if (rows.length === 0) {
      await client.query(
        `insert into customers
           (name, kind, edrpou, contact, phone, price_level, payment_terms_days, credit_limit,
            ipn, is_vat_payer, address, delivery_address, iban, bank_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [name, kind, edrpou, contact, phone, level, terms, limit, ipn, isVat, address,
         delivery, iban, bank],
      );
    } else {
      await client.query(
        `update customers set ipn = $2, is_vat_payer = $3, address = $4,
                              delivery_address = $5, iban = $6, bank_name = $7
          where id = $1`,
        [rows[0].id, ipn, isVat, address, delivery, iban, bank],
      );
    }
  }

  // Вхідний контроль: сировина завжди, з пакування — те, що контактує з
  // продуктом. Плівці потрібна декларація про відповідність матеріалів,
  // призначених для контакту з харчовими продуктами, а картонному шоубоксу ні.
  await client.query("update items set quality_control = (kind = 'raw' or sku = 'PAK-FLOW')");
  await client.query(
    `update items set acceptance_spec = $1
      where kind = 'raw' and acceptance_spec is null`,
    ['Посвідчення про якість, цілісність тари, без стороннього запаху, залишковий строк не менше 2/3'],
  );

  for (const [sku, label, kcal, protein, fat, sat, carbs, sugars, polyols, fiber, salt, allergens]
       of NUTRITION) {
    await client.query(
      `update items set
         label_name = coalesce(label_name, $2),
         kcal_100 = $3, protein_100 = $4, fat_100 = $5, fat_sat_100 = $6,
         carbs_100 = $7, sugars_100 = $8, polyols_100 = $9, fiber_100 = $10, salt_100 = $11,
         nutrition_source = coalesce(nutrition_source, $12),
         country_of_origin = coalesce(country_of_origin, 'Україна')
       where sku = $1`,
      [sku, label, kcal, protein, fat, sat, carbs, sugars, polyols, fiber, salt,
       'Демонстраційні дані — замінити на специфікацію постачальника'],
    );

    for (const code of allergens) {
      await client.query(
        `insert into item_allergens (item_id, allergen_code, kind)
         select id, $2, 'contains' from items where sku = $1
         on conflict (item_id, allergen_code) do update set kind = excluded.kind`,
        [sku, code],
      );
    }
  }

  // Сліди арахісу оголошує сам продукт, а не інгредієнт: ризик іде від
  // спільної лінії, на якій робиться арахісовий батончик. У самому
  // арахісовому це не «сліди», а склад, тож його виключаємо.
  await client.query(
    `insert into item_allergens (item_id, allergen_code, kind)
     select id, 'peanuts', 'traces' from items
      where kind = 'finished' and sku <> 'VRD-Z-ARAH'
     on conflict (item_id, allergen_code) do nothing`,
  );
  await client.query(
    `update items set country_of_origin = coalesce(country_of_origin, 'Україна')
      where kind in ('finished', 'semi')`,
  );

  // Затверджені постачальники: без цього переліку вхідний контроль не дасть
  // прийняти жодної партії. Дата перегляду — рік, як у типовій процедурі.
  await client.query(
    `update suppliers
        set is_approved = true,
            approved_on = coalesce(approved_on, current_date - 30),
            approved_until = coalesce(approved_until, current_date + 335),
            approval_note = coalesce(approval_note, 'Анкета постачальника, декларації виробника')
      where is_active`,
  );

  for (const [code, name, kind, stage, parameter, unit, min, max, freq, gap,
              monitoring, corrective, verification, auto] of HACCP_POINTS) {
    await client.query(
      `insert into haccp_points
         (code, name, kind, stage, parameter, unit, limit_min, limit_max, frequency,
          max_gap_hours, monitoring, corrective_action, verification, auto_source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (code) do update set
         name = excluded.name, kind = excluded.kind, stage = excluded.stage,
         parameter = excluded.parameter, unit = excluded.unit,
         limit_min = excluded.limit_min, limit_max = excluded.limit_max,
         frequency = excluded.frequency, max_gap_hours = excluded.max_gap_hours,
         monitoring = excluded.monitoring, corrective_action = excluded.corrective_action,
         verification = excluded.verification, auto_source = excluded.auto_source`,
      [code, name, kind, stage, parameter, unit, min, max, freq, gap,
       monitoring, corrective, verification, auto],
    );
  }

  // Коди для податкової накладної. Значення робочі, але їх треба звірити
  // з довідниками — помилковий код є підставою не прийняти накладну.
  await client.query(
    `update items set uktzed = coalesce(uktzed, '1806 90 90 00'), uom_code = coalesce(uom_code, '2009')
      where kind = 'finished'`,
  );

  // Клієнт «наша роздрібна» вказує на юрособу — це вмикає реалізацію між своїми.
  await client.query(
    `update customers
        set legal_entity_id = (select id from legal_entities where short_name = $2)
      where name = $1`,
    ['ФОП Ковальчук О.М. (наша роздрібна)', ENTITIES[1].short],
  );

  // Вхідні залишки: гроші на рахунку й капітал. Без них актив не зійдеться з пасивом.
  for (const [short, amount] of [[ENTITIES[0].short, 500000], [ENTITIES[1].short, 50000]]) {
    for (const [code, debit, credit] of [['311', amount, 0], ['40', 0, amount]]) {
      await client.query(
        `insert into opening_balances (legal_entity_id, code, as_of, debit, credit)
         select id, $2, date_trunc('month', current_date)::date, $3, $4
           from legal_entities where short_name = $1
         on conflict (legal_entity_id, code, as_of) do update
           set debit = excluded.debit, credit = excluded.credit`,
        [short, code, debit, credit],
      );
    }
  }

  await client.query('commit');
  console.log(
    `Довідники заповнено: ${ENTITIES.length} юрособи, ${USERS.length} користувачів, ${ITEMS.length} позицій, ` +
      `${RECIPES.length} рецептур, ${SUPPLIERS.length} постачальників, ${CUSTOMERS.length} клієнтів, ` +
      `${HACCP_POINTS.length} точок HACCP, поживні дані для ${NUTRITION.length} видів сировини.`,
  );
  console.log(`Пароль для всіх демо-акаунтів: ${DEMO_PASSWORD}`);
} catch (err) {
  await client.query('rollback');
  console.error(err.message);
  process.exit(1);
} finally {
  await client.end();
}
