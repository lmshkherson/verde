/**
 * Сума прописом українською — обов'язковий реквізит видаткової накладної.
 *
 * Складність тут не в числах, а в узгодженні: гривня жіночого роду («одна
 * тисяча», «дві гривні»), а тисяча ще й сама вимагає жіночої форми одиниць,
 * тоді як мільйон — чоловічої. Тому одиниці передаються в рід розряду.
 */

const ONES_M = [
  '', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять",
  'десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять', "п'ятнадцять",
  'шістнадцять', 'сімнадцять', 'вісімнадцять', "дев'ятнадцять",
];
const ONES_F = [...ONES_M];
ONES_F[1] = 'одна';
ONES_F[2] = 'дві';

const TENS = [
  '', '', 'двадцять', 'тридцять', 'сорок', "п'ятдесят", 'шістдесят', 'сімдесят',
  'вісімдесят', "дев'яносто",
];
const HUNDREDS = [
  '', 'сто', 'двісті', 'триста', 'чотириста', "п'ятсот", 'шістсот', 'сімсот',
  'вісімсот', "дев'ятсот",
];

/** Форма слова за останніми цифрами: 1 гривня, 2 гривні, 5 гривень. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Група з трьох цифр словами. `feminine` — для тисяч і гривень. */
function trio(n: number, feminine: boolean): string[] {
  const ones = feminine ? ONES_F : ONES_M;
  const words: string[] = [];
  if (n >= 100) words.push(HUNDREDS[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest >= 20) {
    words.push(TENS[Math.floor(rest / 10)]);
    if (rest % 10 > 0) words.push(ones[rest % 10]);
  } else if (rest > 0) {
    words.push(ones[rest]);
  }
  return words;
}

const SCALES: { value: number; feminine: boolean; forms: [string, string, string] }[] = [
  { value: 1_000_000_000, feminine: false, forms: ['мільярд', 'мільярди', 'мільярдів'] },
  { value: 1_000_000, feminine: false, forms: ['мільйон', 'мільйони', 'мільйонів'] },
  { value: 1_000, feminine: true, forms: ['тисяча', 'тисячі', 'тисяч'] },
];

/** Ціле число словами. Рід одиниць останньої групи задає `feminine`. */
export function numberToWords(value: number, feminine = true): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'нуль';

  const words: string[] = [];
  for (const scale of SCALES) {
    const count = Math.floor(n / scale.value);
    if (count === 0) continue;
    words.push(...trio(count, scale.feminine), plural(count, ...scale.forms));
    n %= scale.value;
  }
  if (n > 0) words.push(...trio(n, feminine));

  return words.join(' ');
}

/**
 * Сума в гривнях прописом: «Двадцять дві тисячі вісімсот сорок вісім гривень
 * 00 копійок». Копійки цифрами — так їх друкує і 1С, і банківські бланки:
 * прописом їх ніхто не звіряє, а цифри читаються швидше.
 */
export function amountInWords(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100);
  const hryvnia = Math.floor(rounded / 100);
  const kopiyky = rounded % 100;

  const words = numberToWords(hryvnia, true);
  const text = `${words} ${plural(hryvnia, 'гривня', 'гривні', 'гривень')} ${String(kopiyky).padStart(2, '0')} ${plural(kopiyky, 'копійка', 'копійки', 'копійок')}`;

  return text.charAt(0).toUpperCase() + text.slice(1);
}
