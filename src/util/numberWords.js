const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? `-${ONES[o]}` : ''}`;
}

function threeDigits(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/** Indian numbering: 12,34,567 → twelve lakh thirty-four thousand five hundred sixty-seven */
export function numberToWordsIndian(value) {
  const num = Math.floor(Math.abs(Number(value) || 0));
  if (num === 0) return 'zero';
  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const rest = num % 1000;
  const parts = [];
  if (crore) parts.push(`${numberToWordsIndian(crore)} crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** "Rupees five lakh only" */
export function rupeesInWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (!n) return '';
  return `Rupees ${numberToWordsIndian(n)} only`.replace(/\s+/g, ' ');
}

export function formatIndianCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const [whole, decimal] = Math.abs(num).toFixed(2).split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  const sign = num < 0 ? '-' : '';
  return `${sign}Rs. ${grouped}${decimal === '00' ? '' : `.${decimal}`}`;
}
