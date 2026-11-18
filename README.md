# Uzaa POS

Multi-business, multi-branch point of sale. Next.js 14 + Supabase.

## Deploy (about 10 minutes)

1. Create a Supabase project. In SQL Editor, run `supabase/schema.sql` once.
2. Authentication > Providers > Email: switch OFF "Confirm email" (so businesses can sign up and start selling immediately).
3. Copy `.env.example` to `.env.local` and fill in the three values (Project Settings > API). The service role key is secret: set it only in Vercel env vars, never in the browser code.
4. `npm install && npm run dev` to test locally, or push to GitHub and import in Vercel, adding the same three env vars.
5. Sign up once on `/signup` with your own email, then make yourself super admin in the SQL Editor:

```sql
update profiles set role = 'super_admin', business_id = null, branch_id = null where email = 'YOUR_EMAIL';
```

Sign out and in again: you land on the All businesses screen.

## Onboarding a client (super admin)

Run `supabase/security-patch-12.sql` (or `apply-all.sql`) once. Then on the admin page:

1. Press **Onboard a client**: proprietor, business, email, phone, kind of business, address. The owner is emailed a link to set a password, and the business waits for activation.
2. Choose the service agreement: **Generate agreement** (plan, set-up fee, subscription, start date, minimum term, branches, how to pay, special terms) or **Upload my own PDF** (up to 3 MB).
3. Send the private signing link on WhatsApp, by email, or copy it. The client reads the agreement on their phone, types their name, signs with a finger and ticks that they agree. The time, internet address and device are recorded with a SHA-256 fingerprint of the document.
4. The client shows as **Signed** and appears under *Needs your attention*. Press **Activate** when payment is in. Download the signed PDF (or, for an uploaded PDF, the signature certificate) from the Agreements tab.

Existing clients get an agreement from the **Agreement** button on their row. **New link** replaces a lost link; **Cancel** stops it. The agreement wording is in `lib/agreement.js` (`buildContent`); each agreement keeps the wording it was sent with, so editing the template never changes one already sent. The provider details come from `AGREEMENT_PROVIDER_*` and `AGREEMENT_SIGNATORY*` in Vercel (default: The Biziirise Solutions, Nairobi).

The admin page also shows each client's sales today, last 7 and 30 days (with the change against the 30 days before), the owner's contacts, and whether they have signed in.

## Uzaa Assistant

Every signed-in screen has the Uzaa Assistant in the corner: a face that blinks, follows the pointer, thinks while it looks things up, smiles when it finds the answer and dozes off when left alone. It answers from the built-in how-to library in `lib/assistant-kb.js` (no AI service, works offline), only shows answers for the person's role, suggests topics for the screen they are on, and links straight to the right screen. Add an entry to `KB` to teach it something new. People can hide it (it leaves a small tab on the edge).

## Self sign-up

Or send them to `/signup`. They pick a business type, and they are selling within minutes: add products (scan the barcode into the barcode box), add opening stock, sell. Owners add cashiers and managers under Staff and extra branches under Branches.

## Hardware

- Barcode scanners (USB or Bluetooth) work as a keyboard: click the search box on the Sell screen and scan. No driver needed.
- No scanner? Use the phone or laptop camera. Sell: the barcode button next to search adds each scanned item to the sale (switch to "Take off sale" to remove). Stock: "Scan to add stock" / "Scan to remove stock" changes stock with every scan, with Undo. Products: "Scan" opens the item (or starts adding it), and "Camera" fills the barcode box. Chrome on Android reads every common code type with the phone's own reader; other browsers (iPhone, Windows) use the built-in reader in `lib/barcode.js`, which reads EAN-13, EAN-8 and UPC-A. The camera needs the https address (or localhost).
- Receipts print through the browser print dialog, laid out for 80 mm thermal paper. Tick "Print receipt automatically" on the receipt window to skip the click. For 58 mm paper, change `80mm` in `app/globals.css`.
- To print without the dialog, start Chrome with `--kiosk-printing` on the till computer.

## E-receipts on WhatsApp

1. Run `supabase/security-patch-11.sql` (or `apply-all.sql`) in the SQL Editor.
2. In Vercel set `RECEIPT_SECRET` (a long random string, set once and never change it) and `PUBLIC_SITE_URL=https://uzaa.co.ke`.
3. Owners turn it on when they sign up, or under Settings > E-receipts on WhatsApp: the shop's WhatsApp number, logo, brand colour, thank-you message, one extra link (for example a Google review link) and whether "Powered by Uzaa" shows.
4. After a sale the cashier taps **E-receipt** (or opens the sale under Sales), types the customer's number, and WhatsApp opens on the till phone with the message ready. The message comes from whichever WhatsApp account is on that phone, so log it into the shop's number.
5. The link opens `/r/<token>`: a public, branded receipt page that never expires and can be printed or saved as PDF.


## Subscription billing (Paystack)

Clients pay for Uzaa with M-Pesa or card through Paystack. Uzaa locks a business that has not paid.

1. Run `supabase/security-patch-18.sql` (or `apply-all.sql`) in the SQL Editor.
2. In Vercel set `PAYSTACK_SECRET_KEY` (`sk_test_...` while testing, `sk_live_...` to go live) and `PUBLIC_SITE_URL=https://uzaa.co.ke`. Optional: `BILLING_GRACE_DAYS` (default 7).
3. In Paystack, open Settings > API Keys & Webhooks and set the webhook URL to `https://uzaa.co.ke/api/paystack/webhook`. Set it once in Test Mode and again in Live Mode.

How it works:

- When a client signs a generated agreement, their plan, price, period and set-up fee become their subscription. The signed page shows **Pay**. They pay the set-up fee plus the first period, and the business switches on by itself.
- Owners see **Billing** in the menu: plan, paid-up date, Pay now, and their payment history. Paying early adds a full period after the current paid-up date.
- A card payment can be saved, at the client's choice, and charged automatically on the due date. M-Pesa is never charged automatically. Owners can remove the card under Billing.
- Each day at 08:00 (`/api/billing/daily`, see `vercel.json`), Uzaa charges saved cards that are due. It reminds owners by phone alert 5 days and 1 day before the due date and on the day, and again while they are overdue. A business more than 7 days overdue is locked (`lapsed`): nobody can sell, and the owner sees **Pay and unlock**. Its data is kept. A payment unlocks it immediately.
- The super admin sees a Billing column and a **Billing** button for each business. Use it to set the price for clients without a generated agreement, or to record a payment made outside Paystack by moving "Paid up to" forward. A business with no paid-up date is never locked.
- A payment only counts once Paystack confirms it to our server, either through the return page or the webhook. The amount and currency are checked against what was asked.

### Price list and self sign-up (patch 20)

Run `supabase/security-patch-20.sql` (or `apply-all.sql`) once.

- The prices live in `lib/plans.js`. Uzaa POS Standard costs KES 250 a week, KES 900 a month or KES 2,500 every 3 months. Change them there.
- At `/signup` the client chooses how to start and how often they pay (weekly, monthly or every 3 months):
  - **Free for 7 days** (`TRIAL_DAYS`): the business is active at once. When the trial ends, the usual reminders, 7-day grace and lock apply.
  - **Pay now**: the business waits as *pending*. The owner sees a "Pay to start" screen with the price and a Pay button, and the business switches on when Paystack confirms. If they leave without paying, that screen also offers the free trial, once. Clients on a signed agreement never get the trial option.
- Owners on the price list can switch between weekly, monthly and every 3 months under Billing. The change applies from their next payment.
- A client the admin prices by hand keeps that price, and only the admin can change it. In the admin Billing box, a client is on the price list when the plan name is "Uzaa POS Standard" and the amount equals a list price.
- Clients that already existed before patch 20 are not touched. Set their billing from the admin page.
