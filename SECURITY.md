# Uzaa security

Last audit: after the sign-in rebuild (Biziirise build standards, sections A and B).
Run order for the database: `schema.sql` (new installs) or `security-patch.sql` then `security-patch-2.sql` (existing installs).

## How sign-in works now

| Need | How Uzaa does it |
|---|---|
| Confirm signup, reset password, magic link, invite, change email, confirmation code | Each has a screen a person can start: Create account and "send it again" (signup), Forgot password (reset), "Email me a sign-in link" (magic link), Add staff > Email them an invite (invite), Security > Change email, Security > Change password (emailed code). Every email button opens `/auth/confirm`, which checks the one-time token on our server. |
| Session | Stored in an httpOnly, Secure, SameSite=Strict cookie. The browser holds no token (nothing in localStorage). All data calls go through `/api/sb`, which adds the credentials on the server. |
| Roles | Enforced in the database (row level security) and in every admin API route. The page never decides who is allowed. |
| Two-step verification | Authenticator app (TOTP) with 8 one-time backup codes. Required for the super admin, optional for everyone else. Enforced in the database: once a user has it on, no data opens until the second step is done (aal2). |
| Rate limiting | Postgres counters per IP and per account on sign in, signup, forgot, magic link, resend, code entry, code emailing, staff actions. |
| Lockout | After 3 wrong passwords a captcha is asked (if Turnstile keys are set) and delays double each try; after 10 the account is locked 15 minutes. An IP address gets a far higher allowance (10 free, lock at 30) so one shop wifi is not locked out by one person. Reset and magic link keep working during a lock. |
| Passwords | 12+ characters with upper, lower, number and symbol; common and obvious passwords blocked; checked against known breaches (Have I Been Pwned, k-anonymity, only 5 hash characters leave the server); live strength meter. Enforced on the server for signup, reset, change, and staff passwords. |
| Failed attempts | Logged to `auth_events` (emails stored only as keyed hashes). Kept 180 days. |

## What changed in this round
1. Cookie sessions with a same-origin data gateway, replacing browser-held tokens.
2. New screens: Forgot password, Reset password / accept invite, Two-step code, Security (password, email, 2FA, backup codes).
3. Login: lockout, captcha after 3 failures, "email me a sign-in link", "send confirmation again".
4. Signup: strength meter, breach check, check-your-email screen, business created after the link is opened.
5. Staff: invite by email or owner-set password; "Email a link" and "Set password" replace the old prompt box.
6. Super admin must use 2FA; `/admin` also needs the second step in the route guard.
7. Database: rate-limit and log tables, backup codes table, 2FA-aware helper functions, email sync trigger.
8. Speed: 10 indexes; policies call helper functions once per query instead of once per row.
9. Content Security Policy tightened: pages can no longer connect to Supabase directly, only to Uzaa and (optionally) Cloudflare Turnstile.
10. Fixed a bug in the old staff route (its body reader called itself).

## Known limits (read these)
- **Account lock can be triggered by someone else.** An attacker who knows an email can cause a 15 minute lock. The owner can still get in with the email link or password reset. Delays grow gradually to limit this.
- **Backup codes recover a lost phone, so they are only as strong as where you keep them.** Using one removes 2FA and forces setup again.
- **Cashier cost price is hidden in the screens only.** The database still lets a cashier read cost price through the API. Planned: a view without cost for cashiers.
- **Captcha is off until you add Turnstile keys.** Lockout and delays still work without it.
- **Caching and partitioning:** lists are paged (sales 500, products and stock up to 5,000 rows). Until a business has more than about 50,000 sales a year, indexes are enough. Past that, split `sales`, `sale_items` and `stock_movements` by month. Report totals are computed in the database, not in the browser.
- eTIMS and Uzaa Pay are not built yet.

## Supabase settings to switch on (dashboard)
Authentication > Providers > Email: Confirm email ON, Secure password change ON, Secure email change ON, Minimum password length 12.
Authentication > Multi-Factor: TOTP enabled.
Authentication > URL Configuration: Site URL `https://uzaa.co.ke`, redirect `https://uzaa.co.ke/**`.
Authentication > Emails: paste the six templates from `supabase/email-templates` and turn on custom SMTP (see the README in that folder).
Vercel > Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (never public). Optional: Turnstile keys.

## Checks run
- Mock-backend tests: cross-origin posts blocked (403), cookie flags HttpOnly + Secure + SameSite=Strict, gateway rejects non-data paths and path tricks (404), unsigned requests (401), cross-origin writes through the gateway (403), lockout after repeated wrong passwords (429), captcha demanded at 3 failures, 2FA prompt for users with it, unconfirmed account message, `/admin` bounced without the second step, signed-out visitors bounced to login, unsafe redirect targets rejected, forgot-password rate limited, weak passwords rejected, logout clears the cookie, auth log holds no raw emails.
- `npm run build` clean. `npm audit`: 0 vulnerabilities.
- Not tested against a live Supabase project: run one real signup, reset, invite and 2FA enrolment after deploying.

## Added later: categories, units, exports
- Excel download of sales: owners and managers only, limited to one year per file and 20 requests an hour, read through the signed-in user's own database permissions (so it can never include another business). Item names that start with "=" are written as plain text, not formulas.
- Print links for the Bluetooth Print app are signed, tied to one sale, and expire after 30 minutes.
- `categories` table has row level security: owners and managers of that business only.

## Offline sales

- Each sale gets a client id made on the phone; the database keeps one row per (business, client id), so a re-sent sale is never recorded twice.
- The phone stores a copy of products, stock and settings (no cost prices) and the unsent sales in IndexedDB. No sign-in token is stored there; the session stays in the httpOnly cookie.
- Offline sales keep their real time (rejected if in the future or older than 45 days) and the price the customer was charged. A price that differs from the list price marks the sale "price differs" for the owner. Online sales always use the server price.
- Sales upload only under the login that made them. Signing out keeps unsent sales on the phone and warns first.
- Non-cash offline payments need the payment code (for example the M-Pesa code) so the owner can check it later.

## Credit sales

- Switched on per business. Credit is a payment method: the sale is saved and stock moves as usual, the sale stays unpaid and carries the customer.
- The database, not the browser, enforces it: credit off, no customer, an unknown customer, a deposit larger than the sale, or going past the customer's limit are all refused inside `create_sale`.
- The limit is the business default unless that customer has their own. 0 means no limit.
- Credit sales cannot be made offline, because the limit can only be checked on the server.
- A balance can never go below zero. Customers and payments are row-level-secured to the business; only an owner may delete either, and a payment records who took it.
