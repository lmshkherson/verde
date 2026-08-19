/**
 * EAN-13 і EAN-8: перевірка, дорахунок контрольної цифри й малюнок у SVG.
 *
 * Окрема бібліотека тут була б зайвою: кодування EAN описується трьома
 * таблицями на десять рядків, а власний код не тягне за собою залежність,
 * яку доведеться оновлювати роками заради накладної.
 */

// Три набори по 7 модулів на цифру. L і G — ліва половина, R — права.
const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
const R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];

/**
 * Перша цифра EAN-13 не має власних смуг — вона закодована тим, у якому
 * порядку чергуються набори L і G у лівій половині. Через це тринадцята
 * цифра «є» на етикетці, хоч смуг під неї немає.
 */
const PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

const digits = (/** @type {string} */ value) => value.split('').map(Number);

/**
 * Контрольна цифра за стандартом GS1: ваги 1 і 3, що чергуються з кінця.
 * @param {string} body
 * @returns {number}
 */
export function checkDigit(body) {
  const d = digits(body).reverse();
  // З кінця вага першої цифри завжди 3 — і для EAN-13, і для EAN-8.
  const sum = d.reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isValidEan(value) {
  if (!/^\d{8}$|^\d{13}$/.test(value)) return false;
  return checkDigit(value.slice(0, -1)) === Number(value.slice(-1));
}

/**
 * Приводить введене до повного коду. GS1 видає префікс без контрольної цифри,
 * тож 12 або 7 цифр — це нормальний спосіб введення, і дорахувати останню
 * система має сама: людина її все одно рахує тим самим алгоритмом.
 */
/**
 * @param {string} input
 * @returns {{ean: string} | {error: string}}
 */
export function normalizeEan(input) {
  const raw = input.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(raw)) return { error: 'Штрихкод складається лише з цифр' };

  if (raw.length === 12 || raw.length === 7) return { ean: raw + checkDigit(raw) };

  if (raw.length !== 13 && raw.length !== 8) {
    return { error: `EAN має 13 або 8 цифр, введено ${raw.length}` };
  }
  if (!isValidEan(raw)) {
    const expected = checkDigit(raw.slice(0, -1));
    return {
      error: `Контрольна цифра не сходиться: за перших ${raw.length - 1} цифр має бути ${expected}, а не ${raw.slice(-1)}`,
    };
  }
  return { ean: raw };
}

/** Рядок із нулів і одиниць: 1 — чорний модуль. */
/**
 * @param {string} ean
 * @returns {string}
 */
function modules(ean) {
  if (ean.length === 13) {
    const d = digits(ean);
    const parity = PARITY[d[0]];
    const left = d
      .slice(1, 7)
      .map((n, i) => (parity[i] === 'L' ? L[n] : G[n]))
      .join('');
    const right = d.slice(7).map((n) => R[n]).join('');
    return `101${left}01010${right}101`;
  }

  const d = digits(ean);
  const left = d.slice(0, 4).map((n) => L[n]).join('');
  const right = d.slice(4).map((n) => R[n]).join('');
  return `101${left}01010${right}101`;
}

/**
 * Малюнок штрихкоду. Розміри в модулях (X), а не в пікселях: масштаб задається
 * один раз шириною модуля, і код лишається придатним до зчитування на будь-якому
 * принтері. Захисні смуги довші за решту — по них сканер шукає межі коду.
 *
 * Типова ширина модуля 0,264 мм — це нижня межа діапазону GS1 (масштаб 80%).
 * Вужче робити не можна: звичайний офісний принтер уже не витримує геометрію,
 * і сканер перестає читати код. Висоту, на відміну від ширини, у документі
 * доводиться зменшувати — повні 18 мм на кожен рядок таблиці не влізуть, і це
 * свідомий компроміс: ручний сканер укорочений код читає, касовий може не взяти.
 */
/**
 * @param {string} ean
 * @param {{moduleMm?: number, barHeight?: number}} [options]
 * @returns {{svg: string, widthMm: number} | null}
 */
export function eanSvg(ean, { moduleMm = 0.264, barHeight = 60 } = {}) {
  if (!isValidEan(ean)) return null;

  const isEan13 = ean.length === 13;
  const bits = modules(ean);
  // Зони спокою обов'язкові: без них сканер не бачить початок коду.
  const quietLeft = isEan13 ? 11 : 7;
  const quietRight = 7;
  const total = quietLeft + bits.length + quietRight;
  const guardExtra = 5;
  const textY = barHeight + guardExtra + 8;
  const height = textY + 2;

  // Захисні смуги: початкова, центральна й кінцева.
  const guards = isEan13
    ? new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94])
    : new Set([0, 1, 2, 31, 32, 33, 34, 35, 64, 65, 66]);

  let bars = '';
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] !== '1') continue;
    const h = guards.has(i) ? barHeight + guardExtra : barHeight;
    bars += `<rect x="${quietLeft + i}" y="0" width="1" height="${h}"/>`;
  }

  // Цифри під кодом розставлені так само, як на заводській етикетці.
  const label = (/** @type {string} */ text, /** @type {number} */ x, anchor = 'middle') =>
    `<text x="${x}" y="${textY}" font-family="Helvetica, Arial, sans-serif" font-size="9" text-anchor="${anchor}">${text}</text>`;

  let texts = '';
  if (isEan13) {
    texts += label(ean[0], quietLeft - 2, 'end');
    texts += label(ean.slice(1, 7), quietLeft + 3 + 21);
    texts += label(ean.slice(7), quietLeft + 50 + 21);
  } else {
    texts += label(ean.slice(0, 4), quietLeft + 3 + 14);
    texts += label(ean.slice(4), quietLeft + 36 + 14);
  }

  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" ` +
      `width="${(total * moduleMm).toFixed(2)}mm" shape-rendering="crispEdges">` +
      `<rect width="${total}" height="${height}" fill="#fff"/>` +
      `<g fill="#000">${bars}${texts}</g></svg>`,
    widthMm: Number((total * moduleMm).toFixed(2)),
  };
}
