// Password rules shared by the browser (live meter) and the server (enforcement).
export const MIN_LEN = 12;
export const MAX_LEN = 100;

const COMMON = new Set(`password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword qwerty qwerty123 qwertyuiop
12345678 123456789 1234567890 12345678910 123123123 111111111111 000000000000 abc12345 abcd1234 iloveyou iloveyou1 welcome welcome1 welcome123
admin admin123 administrator letmein letmein123 monkey dragon football baseball master login princess sunshine superman trustno1
changeme default secret kenya kenya123 nairobi nairobi123 mombasa uzaa uzaapos uzaa123 mpesa mpesa123 biziirise shopkeeper dukapassword
asdfghjkl zxcvbnm 1q2w3e4r 1qaz2wsx qazwsxedc passwordpassword`.split(/\s+/));

export const SYMBOL = /[^A-Za-z0-9]/;

export function checks(pw = '', email = '') {
  const p = String(pw);
  const local = String(email).split('@')[0].toLowerCase();
  const lower = p.toLowerCase();
  const stripped = lower.replace(/[^a-z0-9]/g, '');
  return {
    length: p.length >= MIN_LEN,
    upper: /[A-Z]/.test(p),
    lower: /[a-z]/.test(p),
    number: /[0-9]/.test(p),
    symbol: SYMBOL.test(p),
    notCommon: !(COMMON.has(lower) || COMMON.has(stripped) || /^(.)\1+$/.test(p) || /^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(lower)),
    notEmail: !(local.length >= 4 && lower.includes(local)),
  };
}

export const LABELS = {
  length: `At least ${MIN_LEN} characters`,
  upper: 'An uppercase letter',
  lower: 'A lowercase letter',
  number: 'A number',
  symbol: 'A symbol such as ! @ # $',
  notCommon: 'Not a common or easy-to-guess password',
  notEmail: 'Does not contain your email name',
};

export function passwordIssue(pw, email = '') {
  if (typeof pw !== 'string' || !pw) return 'Enter a password';
  if (pw.length > MAX_LEN) return `Password must be at most ${MAX_LEN} characters`;
  const c = checks(pw, email);
  const first = Object.keys(c).find((k) => !c[k]);
  if (!first) return null;
  if (first === 'notCommon') return 'That password is too common. Choose something harder to guess.';
  if (first === 'notEmail') return 'Your password should not contain your email name.';
  return `Password needs: ${LABELS[first].toLowerCase()}`;
}

// Rough strength 0-4 for the meter (length, variety, repeats, sequences). Not a substitute for the rules above.
export function strength(pw = '', email = '') {
  if (!pw) return 0;
  const c = checks(pw, email);
  if (!c.notCommon || !c.notEmail) return 1;
  let pool = 0;
  if (c.lower) pool += 26;
  if (c.upper) pool += 26;
  if (c.number) pool += 10;
  if (c.symbol) pool += 33;
  const uniq = new Set(pw).size;
  const effectiveLen = Math.min(pw.length, uniq * 2);
  const bits = effectiveLen * Math.log2(Math.max(pool, 2));
  let s = bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  if (!(c.length && c.upper && c.lower && c.number && c.symbol)) s = Math.min(s, 2);
  return s;
}
export const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];
