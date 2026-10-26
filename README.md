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

## Onboarding a client

Send them to `/signup`. They pick a business type, and they are selling within minutes: add products (scan the barcode into the barcode box), add opening stock, sell. Owners add cashiers and managers under Staff and extra branches under Branches.

## Hardware

- Barcode scanners (USB or Bluetooth) work as a keyboard: click the search box on the Sell screen and scan. No driver needed.
- No scanner? Use the phone or laptop camera. Sell: the barcode button next to search adds each scanned item to the sale (switch to "Take off sale" to remove). Stock: "Scan to add stock" / "Scan to remove stock" changes stock with every scan, with Undo. Products: "Scan" opens the item (or starts adding it), and "Camera" fills the barcode box. Chrome on Android reads every common code type with the phone's own reader; other browsers (iPhone, Windows) use the built-in reader in `lib/barcode.js`, which reads EAN-13, EAN-8 and UPC-A. The camera needs the https address (or localhost).
- Receipts print through the browser print dialog, laid out for 80 mm thermal paper. Tick "Print receipt automatically" on the receipt window to skip the click. For 58 mm paper, change `80mm` in `app/globals.css`.
- To print without the dialog, start Chrome with `--kiosk-printing` on the till computer.
"# uzaa" 
