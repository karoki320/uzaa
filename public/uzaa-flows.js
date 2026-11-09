// Uzaa Assistant: guided conversations. Plain data, shared by the app (components/UzaaAssistant.js)
// and the public landing page (public/uzaa-assistant.js), so both ask the same questions.
//
// A node: { say, options: [{ label, next | href | flow | topic | plan, set }] }
//   say      text, or a function (ctx) => text. ctx = { name, answers, agreement }
//   next     another node in the same flow
//   flow     start another flow
//   href     a link (external: opens a new tab)
//   topic    show a how-to from the library (lib/assistant-kb.js), in the app only
//   plan     show the personal setup checklist, in the app only
//   set      remember an answer, e.g. { branches: '2-3' }

export const UZAA_WA = '254141025616';
const wa = (t) => `https://wa.me/${UZAA_WA}?text=${encodeURIComponent(t)}`;
const first = (ctx) => (ctx && ctx.name ? ` ${String(ctx.name).split(' ')[0]}` : '');

const BRANCHES = (next) => [
  { label: 'Just one', set: { branches: '1' }, next },
  { label: '2 or 3', set: { branches: '2-3' }, next },
  { label: '4 or more', set: { branches: '4+' }, next },
];
const STAFF = [
  { label: 'Just me', set: { staff: 'no' }, next: 'barcodes' },
  { label: 'Cashiers', set: { staff: 'cashiers' }, next: 'roles' },
  { label: 'Cashiers and a manager', set: { staff: 'both' }, next: 'roles' },
];
const ROLES = 'Here is how roles work, so each person gets the right access:\nOwner (you): everything, including staff, branches and settings.\nManager: products, stock and reports, plus selling.\nCashier: sells, and sees only their own sales.\nGive each person their own login, so you always know who sold what. Never share yours.';
const BARCODES = [
  { label: 'Yes, most of them', set: { barcodes: 'yes' }, next: 'receipts' },
  { label: 'Some', set: { barcodes: 'some' }, next: 'receipts' },
  { label: 'No', set: { barcodes: 'no' }, next: 'receipts' },
];
const RECEIPTS = [
  { label: 'Printed', set: { receipts: 'print' }, next: 'credit' },
  { label: 'On WhatsApp', set: { receipts: 'whatsapp' }, next: 'credit' },
  { label: 'Both', set: { receipts: 'both' }, next: 'credit' },
  { label: 'No receipts', set: { receipts: 'none' }, next: 'credit' },
];

// The same setup questions, asked after signing and on first sign-in.
const QUESTIONS = (finish) => ({
  staff: { say: 'Who else will use Uzaa?', options: STAFF },
  roles: { say: ROLES, options: [{ label: 'Makes sense', next: 'barcodes' }] },
  barcodes: { say: 'Do your products have barcodes?', options: BARCODES },
  receipts: { say: 'How will you give customers receipts?', options: RECEIPTS },
  credit: {
    say: 'Last one: do you sell on credit (deni) to some customers?',
    options: [{ label: 'Yes', set: { credit: 'yes' }, ...finish }, { label: 'No', set: { credit: 'no' }, ...finish }],
  },
});

export const FLOWS = {
  // ---------------------------------------------------------------- anyone who is not signed in
  visitor: {
    start: {
      say: (c) => `Hi${first(c)}, I'm Uzaa, your guide. What brings you here today?`,
      options: [
        { label: 'I run a business and I am new to Uzaa', next: 'newType' },
        { label: 'I already use Uzaa', next: 'existing' },
        { label: 'I was sent an agreement to sign', flow: 'agreementHelp' },
        { label: 'Just looking around', next: 'tour' },
      ],
    },
    newType: {
      say: 'Welcome! What kind of business do you run?',
      options: [
        { label: 'Shop / duka', set: { type: 'retail' }, next: 'newBranches' },
        { label: 'Pharmacy', set: { type: 'pharmacy' }, next: 'newBranches' },
        { label: 'Restaurant / cafe', set: { type: 'restaurant' }, next: 'newBranches' },
        { label: 'Salon / services', set: { type: 'salon' }, next: 'newBranches' },
        { label: 'Hardware', set: { type: 'hardware' }, next: 'newBranches' },
        { label: 'Something else', set: { type: 'other' }, next: 'newBranches' },
      ],
    },
    newBranches: { say: 'How many shops or branches do you have?', options: BRANCHES('newStaff') },
    newStaff: {
      say: 'Will other people (cashiers or a manager) use the till too?',
      options: [
        { label: 'Yes', set: { staff: 'cashiers' }, next: 'newPlan' },
        { label: 'No, just me', set: { staff: 'no' }, next: 'newPlan' },
      ],
    },
    newPlan: {
      say: (c) => {
        const a = (c && c.answers) || {};
        return [
          'Uzaa fits you well. Here is how you get started:',
          '1. Create your account (2 minutes), or ask the Uzaa team to set it up for you.',
          '2. Sign your service agreement on your phone.',
          `3. Add your products${a.type === 'pharmacy' ? ' with expiry dates and batch numbers' : ''} and opening stock. A barcode scanner or your phone camera works.`,
          a.branches && a.branches !== '1' ? '4. Add your other branches, each with its own stock and receipts.' : '4. Set up your receipts: printed, WhatsApp or both.',
          a.staff && a.staff !== 'no' ? '5. Add your cashiers and manager, each with their own login and role.' : '5. Make your first sale. It works offline too.',
          'I will guide you through each step once you are in.',
        ].join('\n');
      },
      options: [
        { label: 'Create my account', href: '/signup' },
        { label: 'Have the Uzaa team set me up', href: wa('Hello, I would like Uzaa POS for my business. Please help me get set up.'), external: true },
        { label: 'Book a demo', href: wa('Hello, I would like a demo of Uzaa POS.'), external: true },
      ],
    },
    existing: {
      say: 'Welcome back! What do you need?',
      options: [
        { label: 'Sign in', href: '/login' },
        { label: 'I forgot my password', next: 'forgot' },
        { label: 'I never set a password', next: 'noPassword' },
        { label: 'My account says waiting or suspended', next: 'waiting' },
      ],
    },
    forgot: {
      say: 'No problem. Press "Forgot password", type your email and open the link we send (check Spam too). Staff can also ask the business owner to set a new password for them.',
      options: [{ label: 'Open Forgot password', href: '/forgot-password' }, { label: 'Back', next: 'existing' }],
    },
    noPassword: {
      say: 'When your account was created, Uzaa emailed you an invite ("You have been invited"). Open it and choose your password. Cannot find it? Use Forgot password with the same email: it works for new accounts too.',
      options: [{ label: 'Open Forgot password', href: '/forgot-password' }, { label: 'Sign in', href: '/login' }],
    },
    waiting: {
      say: 'A new account waits until Uzaa activates it, usually right after your agreement is signed and your first payment is in. If it says suspended, please talk to the Uzaa team.',
      options: [
        { label: 'Message the Uzaa team', href: wa('Hello, my Uzaa account is waiting for activation.'), external: true },
        { label: 'I still need to sign my agreement', flow: 'agreementHelp' },
      ],
    },
    tour: {
      say: 'Uzaa is a point of sale for Kenyan businesses. Sell from a phone, tablet or computer, even offline. Track stock across branches, give each staff member their own login, sell on credit (deni), print or WhatsApp receipts, and see your sales from anywhere. What would you like to know?',
      options: [
        { label: 'What do I need to start?', next: 'needs' },
        { label: 'How much does it cost?', next: 'price' },
        { label: 'I want to start', next: 'newType' },
      ],
    },
    needs: {
      say: 'Just a phone, tablet or computer with a browser. A barcode scanner and a receipt printer are optional: the phone camera scans barcodes, and receipts can go on WhatsApp.',
      options: [{ label: 'How much does it cost?', next: 'price' }, { label: 'I want to start', next: 'newType' }],
    },
    price: {
      say: 'You can pay monthly, quarterly or yearly, depending on your plan and branches. The Uzaa team will give you a quote and set you up.',
      options: [
        { label: 'Ask for a quote on WhatsApp', href: wa('Hello, I would like a quote for Uzaa POS.'), external: true },
        { label: 'I want to start', next: 'newType' },
      ],
    },
  },

  // ---------------------------------------------------------------- signing the agreement
  agreementHelp: {
    start: {
      say: (c) => (c && c.agreement
        ? `This is your Uzaa service agreement${c.agreement.business ? ` for ${c.agreement.business}` : ''}. Shall I walk you through it?`
        : 'Open the link Uzaa sent you on WhatsApp or by email. You will read the agreement, type your name, sign with your finger and tick to agree.'),
      options: [
        { label: 'How do I sign?', next: 'how' },
        { label: 'What am I agreeing to?', next: 'what' },
        { label: 'I cannot find my link', next: 'lost' },
        { label: 'I have signed. What next?', flow: 'afterSign' },
      ],
    },
    how: {
      say: '1. Read the agreement (you can also download it as a PDF).\n2. Scroll to "Sign the agreement" at the bottom.\n3. Check your name and add your position if you like (for example Proprietor).\n4. Draw your signature in the box with your finger or mouse. Press Clear to redo it.\n5. Tick the box to agree and press "Sign agreement".',
      options: [{ label: 'What am I agreeing to?', next: 'what' }, { label: 'Got it', next: 'ok' }],
    },
    what: {
      say: 'In short: Uzaa gives you the point of sale on the plan and fees under "Fees and Payment". It runs for the minimum term shown, then continues until either side gives notice. Your data belongs to you and is protected under the Data Protection Act, and you can export it if you leave. Check "Special Terms" for anything agreed just for you.',
      options: [{ label: 'How do I sign?', next: 'how' }, { label: 'I have a question for Uzaa', href: wa('Hello, I have a question about my Uzaa service agreement.'), external: true }],
    },
    lost: {
      say: 'Ask the Uzaa team to send it again. They can make a new link in seconds.',
      options: [{ label: 'Message the Uzaa team', href: wa('Hello, please resend my Uzaa service agreement link.'), external: true }],
    },
    ok: { say: 'Great. I am right here if you get stuck.', options: [] },
  },

  // ---------------------------------------------------------------- right after signing
  afterSign: {
    start: {
      say: (c) => `Congratulations${first(c)}, your agreement is signed! Next, let's get your Uzaa account ready. First: have you set your password yet?`,
      options: [
        { label: 'Yes, my password is set', set: { password: 'yes' }, next: 'activation' },
        { label: 'No, or I cannot find the email', set: { password: 'no' }, next: 'password' },
        { label: 'What email?', next: 'password' },
      ],
    },
    password: {
      say: 'When you were onboarded, Uzaa emailed you an invite ("You have been invited"). Open it and choose a strong password: press the eye button to see what you type, then type it again to confirm.\nCannot find it (check Spam)? Use Forgot password with the same email.',
      options: [
        { label: 'Open Forgot password', href: '/forgot-password' },
        { label: 'Done, my password is set', set: { password: 'yes' }, next: 'activation' },
      ],
    },
    activation: {
      say: 'Next, Uzaa activates your account once your first payment is in. While you wait, let me plan your setup so you can start selling fast. How many shops or branches do you have?',
      options: BRANCHES('staff'),
    },
    ...QUESTIONS({ next: 'done' }),
    done: {
      say: 'Perfect, your setup plan is ready. When you sign in, I will show it as a checklist and take you to each step.',
      options: [{ label: 'Show my setup plan', plan: true }, { label: 'Sign in', href: '/login' }],
    },
  },

  // ---------------------------------------------------------------- owner, account not active yet
  pending: {
    start: {
      say: (c) => `Hi${first(c)}! Your Uzaa account is set up and waiting to be activated. Have you signed your service agreement?`,
      options: [
        { label: 'Yes, I have signed', next: 'signed' },
        { label: 'Not yet', next: 'notSigned' },
        { label: 'I did not get one', next: 'notSigned' },
      ],
    },
    signed: {
      say: 'Great. Uzaa activates your account once your first payment is in. Shall we plan your setup while you wait?',
      options: [
        { label: 'Yes, plan my setup', flow: 'setupQuestions' },
        { label: 'Message the Uzaa team', href: wa('Hello, I have signed my Uzaa agreement. When will my account be activated?'), external: true },
      ],
    },
    notSigned: {
      say: 'Your agreement link was sent on WhatsApp or email. Open it and sign with your finger. Cannot find it? Ask the Uzaa team to resend it.',
      options: [
        { label: 'Ask for my agreement link', href: wa('Hello, please send me my Uzaa service agreement link.'), external: true },
        { label: 'How do I sign?', flow: 'agreementHelp' },
      ],
    },
  },

  // ---------------------------------------------------------------- owner, first time in the till
  setup: {
    start: {
      say: (c) => `Welcome to Uzaa${first(c)}! Let's set up your business. I will ask a few quick questions so I only show you what you need. Ready?`,
      options: [
        { label: "Let's go", flow: 'setupQuestions' },
        { label: 'Show me the checklist', plan: true },
        { label: 'Later', next: 'later' },
      ],
    },
    later: { say: 'No problem. Tap me any time and choose "Set up my business".', options: [] },
  },
  setupQuestions: {
    start: { say: 'How many shops or branches do you have?', options: BRANCHES('staff') },
    ...QUESTIONS({ plan: true }),
  },
};

/**
 * The owner's setup checklist, from their answers and what is already done in Uzaa.
 * progress: { products, stocked, branches, staff, sales, ereceipt, credit, mfa }
 * marked: steps the owner ticked by hand (ones Uzaa cannot see, like the printer).
 */
export function planItems(answers, progress, marked) {
  const a = answers || {}; const p = progress || {}; const m = marked || {};
  const want = a.branches === '4+' ? 4 : a.branches === '2-3' ? 2 : 1;
  const items = [
    { id: 'business', title: 'Check your business details', why: 'Name, tax rate, payment methods (Cash, M-Pesa, Card) and the text on receipts.', href: '/settings', manual: true, done: !!m.business },
  ];
  if (want > 1) items.push({ id: 'branches', title: `Add your other branch${want > 2 ? 'es' : ''}`, why: 'Each branch has its own stock, staff and receipt address.', href: '/branches', done: (p.branches || 0) >= want });
  items.push({ id: 'products', title: 'Add your products and prices', why: a.barcodes === 'no' ? 'Type the name, price and unit. Put them in categories for quick selling.' : 'Scan each barcode with a scanner or the phone camera, then add the price.', href: '/products', done: (p.products || 0) > 0 });
  items.push({ id: 'stock', title: 'Enter your opening stock', why: 'So Uzaa can warn you when something runs low.', href: '/stock', done: (p.stocked || 0) > 0 });
  if (a.staff && a.staff !== 'no') items.push({ id: 'staff', title: a.staff === 'both' ? 'Add your cashiers and manager' : 'Add your cashiers', why: 'Staff > Add staff. Pick the role and branch. Each person gets their own login.', href: '/staff', done: (p.staff || 0) > 1 });
  if (a.receipts === 'print' || a.receipts === 'both') items.push({ id: 'printer', title: 'Connect your receipt printer', why: 'Settings > Receipt printer. Bluetooth and USB thermal printers work.', href: '/settings', manual: true, done: !!m.printer });
  if (a.receipts === 'whatsapp' || a.receipts === 'both') items.push({ id: 'ereceipt', title: 'Turn on WhatsApp receipts', why: 'Settings > E-receipts on WhatsApp: your number, logo and colour.', href: '/settings', done: !!p.ereceipt });
  if (a.credit === 'yes') items.push({ id: 'credit', title: 'Turn on credit sales (deni)', why: 'Settings > Credit sales, with a credit limit. Track who owes you under Credit.', href: '/settings', done: !!p.credit });
  items.push({ id: 'sale', title: 'Make your first sale', why: 'Sell: tap items, choose how they paid, press Charge.', href: '/pos', done: (p.sales || 0) > 0 });
  items.push({ id: 'mfa', title: 'Protect your account', why: 'Security > Two-step verification with an authenticator app.', href: '/security', done: !!p.mfa });
  return items;
}
