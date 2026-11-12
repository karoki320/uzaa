// What the Uzaa Assistant knows. Built in: no AI service, no cost, works offline.
// Each answer: words people might type (keys), who it is for (roles; empty = everyone), the steps,
// and where to go (href). To teach the assistant something new, add an entry here.

const SHOP = ['owner', 'manager', 'cashier'];
const MGMT = ['owner', 'manager'];

export const KB = [
  // ---- selling -------------------------------------------------------------------------------
  { id: 'sell', roles: SHOP, keys: 'sell sale make a sale till charge checkout customer buy start selling', title: 'Make a sale',
    steps: ['Open Sell.', 'Tap items to add them, or type in the search box. A barcode scanner also works: click the search box and scan.', 'Use + and - to change the quantity, or add a discount.', 'Choose how they paid (Cash, M-Pesa, Card) and press Charge.'],
    href: '/pos', go: 'Open Sell' },
  { id: 'camera', roles: SHOP, keys: 'camera scan barcode phone scanner scan with camera qr', title: 'Scan barcodes with the phone camera',
    steps: ['On Sell, press the barcode button next to search.', 'Point the camera at the barcode. Each scan adds the item to the sale.', 'Switch to "Take off sale" to remove items by scanning.', 'The camera needs the https address of Uzaa.'],
    href: '/pos', go: 'Open Sell' },
  { id: 'scanner', roles: SHOP, keys: 'usb bluetooth scanner hardware gun driver', title: 'Use a barcode scanner',
    steps: ['USB and Bluetooth scanners work like a keyboard, no driver needed.', 'Click the search box on Sell and scan. The item goes straight into the sale.'], href: '/pos', go: 'Open Sell' },
  { id: 'print', roles: SHOP, keys: 'print receipt printer thermal xprinter paper 80mm 58mm auto print reprint', title: 'Print a receipt',
    steps: ['After Charge, the receipt opens. Press Print.', 'Tick "Print receipt automatically" to skip that click next time.', 'Missed one? Press "Print again", or open the sale under Sales.', 'Bluetooth or USB thermal printers are set up in Settings > Receipt printer.'],
    href: '/sales', go: 'Open Sales' },
  { id: 'ereceipt', roles: SHOP, keys: 'whatsapp e-receipt ereceipt send receipt digital receipt sms', title: 'Send a receipt on WhatsApp',
    steps: ['After a sale, tap E-receipt.', 'Type the customer\'s phone number.', 'WhatsApp opens with the message ready. Press send.', 'For an older sale, open it under Sales and tap E-receipt.', 'The owner turns this on in Settings > E-receipts on WhatsApp.'],
    href: '/pos', go: 'Open Sell' },
  { id: 'discount', roles: SHOP, keys: 'discount reduce price offer', title: 'Give a discount',
    steps: ['On Sell, add the items.', 'Enter the amount in Discount before you press Charge.'], href: '/pos', go: 'Open Sell' },
  { id: 'split', roles: SHOP, keys: 'split payment part cash part mpesa half cash half mpesa two payments pay with both partial', title: 'Split a payment (part cash, part M-Pesa)',
    steps: ['On Sell, add the items, then press Split under the payment buttons.', 'Type what the customer pays in cash. Uzaa puts the rest on M-Pesa for you (you can change it).', 'If they hand over more cash than needed, Uzaa shows the change to give.', 'Press Charge. The receipt shows each part, and Sales, Reports and closing the day count each part in the right place.'], href: '/pos', go: 'Open Sell' },
  { id: 'credit', roles: SHOP, keys: 'credit deni debt owe owing pay later loan customer balance', title: 'Sell on credit (deni)',
    steps: ['On Sell, choose Credit as the payment.', 'Pick the customer or type a new name and phone number.', 'Their balance shows under Credit. Press "They paid" when money comes in.', '"Remind on WhatsApp" sends a polite reminder.'],
    href: '/credit', go: 'Open Credit' },
  { id: 'sales', roles: SHOP, keys: 'sales history past sale find a sale receipt number view old sale', title: 'Find a past sale',
    steps: ['Open Sales.', 'Pick the dates. Press View on a sale to see it, print it again or send it on WhatsApp.'], href: '/sales', go: 'Open Sales' },
  { id: 'daytotals', roles: SHOP, keys: 'mpesa cash total for the day takings cash in drawer how much mpesa today till balance', title: 'Cash and M-Pesa totals for the day',
    steps: ['Open Sales and pick the day.', 'The first tile is the total. Next to it is one tile for each way of paying (Cash, M-Pesa, Card, Credit). Together they add up to the total.', '"Cash that should be in the drawer" is cash sales less expenses paid in cash.'], href: '/sales', go: 'Open Sales' },
  { id: 'closeday', roles: SHOP, keys: 'close day closing cash count count cash drawer till balance short over end of day reconcile', title: 'Close the day (count the cash)',
    steps: ['Open Sales at closing time and press "Count cash".', 'Count the notes and coins in the drawer, leaving out the float, and type the total.', 'Uzaa shows whether the cash is balanced, short or over, and tells the owner on their phone.', 'Counted wrong? Press the result and "Count again". The last count stands.'], href: '/sales', go: 'Open Sales' },
  { id: 'reorder', roles: MGMT, keys: 'reorder order supplier restock buy stock low stock whatsapp order list', title: 'Reorder from your supplier',
    steps: ['Open Stock and press "Reorder low items".', 'Check the quantities (set 0 to leave one out).', 'Type the supplier\'s WhatsApp number once and tick "Remember this supplier".', 'Press "Send order on WhatsApp" and send the message.'], href: '/stock', go: 'Open Stock' },
  { id: 'costs', roles: MGMT, keys: 'cost price buying price profit wrong margin what i paid stock value zero', title: 'Add cost prices (for real profit)',
    steps: ['Open Products. If items have no cost price, press "Fill them in".', 'Type what you paid for each item. It saves as you go.', 'Reports then shows your real profit and margin, and Stock shows what your stock is worth.'], href: '/products', go: 'Open Products' },
  { id: 'dark', roles: [], keys: 'dark mode night theme light colours look black screen', title: 'Dark mode',
    steps: ['On a phone, press More at the bottom, then pick Light, Dark or Auto under "Look on this phone".', 'On a computer, use the Light / Dark / Auto switch at the top.', 'Auto follows the phone\'s own setting.'] },
  { id: 'deletesale', roles: ['owner'], keys: 'delete sale wrong sale remove sale cancel sale void mistake refund undo sale', title: 'Delete a wrong sale',
    steps: ['Open Sales, find the sale and press View.', 'Press "Delete this sale", write why, and confirm.', 'The items go back into stock and the sale leaves every total and report.', 'A copy is kept under "deleted sales" on that day, with your name and the reason. Only the owner can delete a sale.'], href: '/sales', go: 'Open Sales' },
  { id: 'expense', roles: SHOP, keys: 'expense expenses spend spent cost rent salary electricity water delivery transport fuel paid out petty cash', title: 'Record an expense',
    steps: ['Open Expenses and press "Add expense".', 'Type the amount, choose what it was for (Rent, Salaries, Delivery, Fuel...) and how often you pay it.', 'Choose where the money came from (Cash, M-Pesa, Bank) and press Save.', 'Cashiers can record small ones up to the limit the owner sets. The owner or a manager then presses "Checked".', 'Reports takes expenses off your profit to show net profit.'], href: '/expenses', go: 'Open Expenses' },
  { id: 'offline', roles: SHOP, keys: 'offline no internet network sync upload waiting pending', title: 'Selling without internet',
    steps: ['Keep selling. Sales are saved on the phone.', 'The chip at the top shows how many are waiting.', 'They upload by themselves when the connection is back. You can also press Retry.', 'Do not sign out while sales are waiting.'] },

  // ---- products and stock ---------------------------------------------------------------------
  { id: 'product', roles: SHOP, keys: 'add product item new product price create medicine menu service', title: 'Add a product',
    steps: ['Open Products and press Add. (Cashiers can add items when the owner allows it in Settings > Staff permissions.)', 'Type the name and price. Scan the barcode into the barcode box, or press Camera.', 'Choose the unit (piece, kg, litre...) and the category.', 'Enter the opening stock and press Save.'],
    href: '/products', go: 'Open Products' },
  { id: 'price', roles: MGMT, keys: 'change price edit product rename hide product delete product', title: 'Change a price or edit a product',
    steps: ['Open Products and tap the item (or press Scan and scan it).', 'Change the price or details and press Save.', 'To stop selling it, set Status to Hidden.'], href: '/products', go: 'Open Products' },
  { id: 'delproducts', roles: MGMT, keys: 'delete product remove product delete many bulk select several items long press hide many', title: 'Delete or hide several items',
    steps: ['Open Products and press and hold an item (or press Select).', 'Tap the other items you want. "All" picks everything in the list.', 'Press Hide to stop selling them, or Delete to remove them for good.', 'Deleting cannot be undone. Past sales keep the item names.'], href: '/products', go: 'Open Products' },
  { id: 'category', roles: ['owner'], keys: 'category categories group', title: 'Categories',
    steps: ['Open Settings > Categories and press Add category.', 'Then pick the category on each product. Categories show as chips on Sell.'], href: '/settings', go: 'Open Settings' },
  { id: 'stock', roles: MGMT, keys: 'stock add stock restock delivery inventory quantity remove stock adjust count', title: 'Add or remove stock',
    steps: ['Open Stock.', 'Press "Add stock" (or "Scan to add stock" and scan each item).', 'To take stock off (damaged, expired), use "Scan to remove stock" or Change.', 'Every change shows under Recent stock changes, with Undo.'],
    href: '/stock', go: 'Open Stock' },
  { id: 'lowstock', roles: MGMT, keys: 'low stock running low out of stock reorder warning', title: 'Low stock',
    steps: ['Set "Low stock warning at" on each product.', 'Reports and Stock list what is running low.'], href: '/reports', go: 'Open Reports' },

  // ---- reports ---------------------------------------------------------------------------------
  { id: 'reports', roles: MGMT, keys: 'report reports performance profit revenue how much did we sell today week summary', title: 'See how the business is doing',
    steps: ['Open Reports.', 'Pick Today, Last 7 days, This week or Last 30 days, and a branch if you have several.', 'You see revenue per day, best sellers and what is running low.'], href: '/reports', go: 'Open Reports' },
  { id: 'excel', roles: SHOP, keys: 'excel export download spreadsheet csv accountant', title: 'Download sales as Excel',
    steps: ['Open Sales.', 'Pick the dates and press "Download sales as Excel".'], href: '/sales', go: 'Open Sales' },
  { id: 'alerts', roles: ['owner'], keys: 'alert notification phone push daily summary end of day', title: 'Alerts on your phone',
    steps: ['Open Settings > Alerts on your phone and turn them on.', 'You get a note for sales and an end-of-day summary.'], href: '/settings', go: 'Open Settings' },

  // ---- people and branches ----------------------------------------------------------------------
  { id: 'staff', roles: ['owner'], keys: 'staff cashier manager employee add user worker login account', title: 'Add a cashier or manager',
    steps: ['Open Staff and press Add staff.', 'Type their name and email, pick Cashier or Manager, and their branch.', 'Choose "Email them an invite", or set a password and give it to them.', 'To stop someone, set them to Disabled.'],
    href: '/staff', go: 'Open Staff' },
  { id: 'staffpw', roles: ['owner'], keys: 'staff forgot password reset cashier password', title: 'A staff member forgot their password',
    steps: ['Open Staff and tap the person.', 'Use "Set password" and give them the new one, or "Email a link".'], href: '/staff', go: 'Open Staff' },
  { id: 'branch', roles: ['owner'], keys: 'branch branches shop location outlet new shop', title: 'Add a branch',
    steps: ['Open Branches and press Add branch.', 'The address prints on that branch\'s receipts.', 'Assign staff to it under Staff.'], href: '/branches', go: 'Open Branches' },
  { id: 'settings', roles: ['owner'], keys: 'settings receipt header footer tax vat currency payment methods mpesa business name logo', title: 'Business settings',
    steps: ['Open Settings.', 'Business: name, tax rate and payment methods.', 'Receipts: header and footer text.', 'E-receipts on WhatsApp: your number, logo and colour.'], href: '/settings', go: 'Open Settings' },

  // ---- account ---------------------------------------------------------------------------------
  { id: 'install', roles: [], keys: 'install app download app home screen phone tablet pwa', title: 'Install Uzaa on a phone',
    steps: ['Open the menu (More on a phone) and press "Install app on this phone".', 'On iPhone: Share > Add to Home Screen.'] },
  { id: 'security', roles: [], keys: 'security two-step 2fa authenticator code password change email', title: 'Password and two-step sign-in',
    steps: ['Open Security.', 'Change your password or email, and turn on two-step verification with an authenticator app.', 'Save the backup codes somewhere safe.'], href: '/security', go: 'Open Security' },
  { id: 'forgot', roles: [], keys: 'forgot password cannot login sign in locked out', title: 'Forgot your password',
    steps: ['On the sign-in screen press "Forgot password".', 'Open the email and choose a new password.', 'Staff can also ask the owner to set a new one under Staff.'] },
  { id: 'pending', roles: [], keys: 'pending waiting activation suspended not active account unavailable activate', title: 'Account waiting or suspended',
    steps: ['A new account waits until Uzaa activates it, usually after the service agreement is signed and payment is in.', 'If it says suspended, contact Uzaa support.'] },

  // ---- visitors (not signed in) ---------------------------------------------------------------
  { id: 'v-signup', roles: ['visitor'], keys: 'sign up signup create account register new start join open account', title: 'Create an Uzaa account',
    steps: ['Press "Create account" (or Sign up).', 'Enter your name, your business name and type, email and a password. Use the eye button to check it and type it again to confirm.', 'Open the email to confirm, then sign in. I will help you set up from there.'], href: '/signup', go: 'Create my account' },
  { id: 'v-signin', roles: ['visitor'], keys: 'sign in login log in enter account access', title: 'Sign in',
    steps: ['Press Sign in.', 'Type your email and password. The eye button shows what you typed.', 'Forgot it? Press "Forgot password".'], href: '/login', go: 'Sign in' },
  { id: 'v-invite', roles: ['visitor'], keys: 'invite invitation email set password never set password new password first time', title: 'Setting your password the first time',
    steps: ['Open the email from Uzaa that says "You have been invited".', 'Choose a password and type it again to confirm.', 'Cannot find it (check Spam)? Use "Forgot password" with the same email.'], href: '/forgot-password', go: 'Open Forgot password' },
  { id: 'v-agreement', roles: ['visitor'], keys: 'agreement contract sign signature service agreement link', title: 'Signing your service agreement',
    steps: ['Open the link Uzaa sent you on WhatsApp or email.', 'Read it, type your name and draw your signature with your finger.', 'Tick to agree and press "Sign agreement". Uzaa activates your account after your first payment.'] },
  { id: 'v-price', roles: ['visitor'], keys: 'price cost how much pricing plan fee subscription monthly quarterly yearly quote', title: 'How much Uzaa costs',
    steps: ['You can pay monthly, quarterly or yearly, depending on your plan and branches.', 'Ask the Uzaa team on WhatsApp (0141 025 616) for a quote.'] },
  { id: 'v-need', roles: ['visitor'], keys: 'need requirements hardware computer phone printer scanner device internet', title: 'What you need',
    steps: ['A phone, tablet or computer with a browser.', 'Optional: a barcode scanner (or use the phone camera) and a receipt printer (or send receipts on WhatsApp).', 'It keeps selling when the internet drops.'] },

  // ---- Uzaa admin ------------------------------------------------------------------------------
  { id: 'onboard', roles: ['super_admin'], keys: 'onboard client new client add business sign up client register customer', title: 'Onboard a client',
    steps: ['On the admin page press "Onboard a client".', 'Fill in the proprietor, business, email and phone. They get an email to set a password.', 'Choose Generate agreement (fill in fees and term) or Upload my own PDF.', 'Send the signing link on WhatsApp, email or copy it.'],
    href: '/admin', go: 'Open admin' },
  { id: 'agreement', roles: ['super_admin'], keys: 'agreement contract service agreement sign signature pdf send agreement esign', title: 'Service agreements',
    steps: ['Use "Agreement" on any client, or the Agreements tab.', 'The client opens the link, reads it and signs with a finger.', 'Once Signed, download the signed PDF (or the certificate for an uploaded PDF).', '"New link" replaces a lost link; "Cancel" stops it.'],
    href: '/admin', go: 'Open admin' },
  { id: 'activate', roles: ['super_admin'], keys: 'activate approve go live suspend reactivate remove delete business', title: 'Activate, suspend or remove a client',
    steps: ['On the admin page, find the client.', 'Activate makes them live. Suspend locks their users out. Remove deletes everything (you type the name to confirm).', 'Signed clients waiting for activation show under "Needs your attention".'],
    href: '/admin', go: 'Open admin' },
  { id: 'perf', roles: ['super_admin'], keys: 'performance clients revenue dashboard which clients active quiet', title: 'Client performance',
    steps: ['The admin page shows today, 7 and 30 day revenue for every client, with the change against the month before.', 'Clients quiet for a week show under "Needs your attention" with their phone number.'], href: '/admin', go: 'Open admin' },
  { id: 'agents', roles: ['super_admin'], keys: 'sales team agent agents commission', title: 'Sales team',
    steps: ['Open the Sales team tab and press "Add an agent".', 'They get an email to set a password, then sign businesses up from their own screen.'], href: '/admin', go: 'Open admin' },
  { id: 'agentbiz', roles: ['sales'], keys: 'set up business sign up shop add business invite owner', title: 'Sign a business up',
    steps: ['Press "Set up a business".', 'Enter the proprietor, business, email and phone.', 'The owner gets an email to set a password. Uzaa activates it after payment.'], href: '/agent', go: 'Open Businesses' },
];

// Short suggestions per screen.
export const SUGGEST = {
  '/pos': ['sell', 'camera', 'credit', 'ereceipt'],
  '/sales': ['sales', 'excel', 'print'],
  '/products': ['product', 'price', 'category'],
  '/stock': ['stock', 'lowstock'],
  '/credit': ['credit'],
  '/reports': ['reports', 'excel'],
  '/branches': ['branch', 'staff'],
  '/staff': ['staff', 'staffpw'],
  '/settings': ['settings', 'ereceipt', 'alerts'],
  '/security': ['security', 'forgot'],
  '/admin': ['onboard', 'agreement', 'activate', 'perf'],
  '/agent': ['agentbiz'],
  '/login': ['v-signin', 'v-invite', 'forgot'],
  '/signup': ['v-signup', 'v-need', 'v-price'],
  '/forgot-password': ['forgot', 'v-invite'],
  '/reset-password': ['v-invite'],
  '/agreement': ['v-agreement', 'v-invite'],
};

const STOP = new Set('a an the i to do how can my we you is it in on of for and or what where with please uzaa me show help'.split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

/** Answers with their scores, best first: [{ k, s }]. */
export function answerScored(q, role) {
  const ws = words(q);
  if (!ws.length) return [];
  return KB.filter((k) => !k.roles.length || k.roles.includes(role))
    .map((k) => ({ k, s: score(k, ws) }))
    .filter((x) => x.s >= 2.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);
}
function score(k, ws) {
  const hay = `${k.keys} ${k.title}`.toLowerCase();
  const toks = hay.split(/\s+/);
  let s = 0;
  for (const w of ws) {
    if (toks.includes(w)) s += 3;
    else if (w.length > 3 && hay.includes(w.slice(0, Math.max(4, w.length - 2)))) s += 1.5;
  }
  if (hay.includes(ws.join(' '))) s += 2;
  return s;
}

/** Best answers for a question, for this role. */
export function answer(q, role) {
  const ws = words(q);
  if (!ws.length) return [];
  const mine = KB.filter((k) => !k.roles.length || k.roles.includes(role));
  return mine
    .map((k) => {
      const hay = `${k.keys} ${k.title}`.toLowerCase();
      let s = 0;
      for (const w of ws) {
        if (hay.split(/\s+/).includes(w)) s += 3;
        else if (w.length > 3 && hay.includes(w.slice(0, Math.max(4, w.length - 2)))) s += 1.5;
      }
      if (hay.includes(ws.join(' '))) s += 2;
      return { k, s };
    })
    .filter((x) => x.s >= 2.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.k);
}

export const forRole = (ids, role) => ids.map((id) => KB.find((k) => k.id === id)).filter((k) => k && (!k.roles.length || k.roles.includes(role)));
