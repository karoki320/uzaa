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

## Patch 9: admin sign-in by email link (replaces the authenticator app for the super admin)
- Password accepted -> that browser session waits, and Uzaa emails a sign-in link to the admin address (Supabase "Magic link" template).
- Opening the link on any device approves the waiting session for 12 hours; the computer continues by itself. Opened in the same browser, that browser goes straight to /admin.
- The link only approves a session that entered the password in the last hour. A link on its own (without the password) opens nothing.
- Enforced in the database: `auth_ok()` accepts the super admin when the token is aal2 OR its `session_id` is approved in `admin_steps`.
- Opening the link approves both the waiting sign-in and the browser it opens in (a phone's Gmail app opens Chrome without the strict cookie).
- A device that completed the email step is remembered for 30 days (`uz_adev` cookie, signed over the user id): there the password alone is enough. A new device needs password + email.
- An authenticator app, if one was set up, still works as an alternative on the same screen.
- Fixed: owners were sent to "create business" because `businesses.agent_id` made the profiles -> businesses link ambiguous. `/api/auth/me` now reads profile, business and branches separately.

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

## Sales team

- A new role, `sales`. A sales agent belongs to Uzaa, not to a shop: no business of their own, and no policy anywhere grants them a shop's products, sales, stock, staff or customers. Verified on a real Postgres: those tables come back "permission denied" for an agent.
- An agent sees only businesses where `agent_id` is their own id, through `agent_businesses()`, which returns the name, the owner, the status and whether the owner has signed in. One agent cannot see another's.
- A business an agent creates starts `pending`. `my_role()` and friends return null while a business is not active, so the owner can be invited and set up but no one sells until the super admin activates it.
- `create_business_as_agent` refuses anyone who is not an active sales agent, and refuses an owner email that already has an account. The server creates the auth user first and deletes it again if the database call fails, so nothing half-made is left.
- Only the super admin, with 2FA, can add or switch off an agent.

## Terms of service

- Every user accepts once. The date and version live on their profile; `accept_terms()` writes only for the caller.
- A new owner ticks the box on the signup form; the server refuses a signup without it, and `register_business` records the acceptance.
- Everyone else is asked at their next sign-in, and nothing else in the app opens until they accept.

## Email links

- Uzaa's templates send people to `/auth/confirm?token_hash=...&type=...`, verified on the server; the session becomes an httpOnly cookie and the reply is a meta-refresh hop so the Strict cookie is sent on the next request.
- Supabase's default templates instead land on the site root with `?code=...`. The root rewrite now sends `?code=`, `?error=` and `?token_hash=` to the handler that can finish them, so such a link no longer shows the sales page. A code link can only complete in the browser that requested it (the PKCE verifier is a cookie), and never for an invite; that case gets a message saying what to do instead.

## Staying signed in

- The middleware rewrites the session cookies on every guarded page. It was setting them without a lifetime, which made them session cookies: everyone was asked to sign in again as soon as they closed the browser or the installed app. They now carry the same 30 days as the cookies the API routes set.

## Phone alerts

- Web push with a VAPID pair held only on the server. A subscription row belongs to one user, with a unique endpoint, and row level security lets a person see and change only their own: verified on a real Postgres with Supabase's grants in place, where a cashier sees only their own and a sales agent sees none.
- The till posts only a sale id. The server reads the sale back, and sends nothing unless the caller is that sale's cashier in that business. Owners are the only recipients, and nothing is sent when an owner rang the sale up themselves.
- Which alerts to send is a business setting an owner alone can change; a cashier's update is refused by row level security.
- The end-of-day summary runs from an hourly scheduled job that must present CRON_SECRET, and `day_summary` is executable only by the service role.

## Never lock someone out of their own till

- The terms gate only appears when the database can actually record the acceptance. If the patch adding `profiles.terms_accepted_at` has not been run, the field is absent and nobody is held at the door; if `accept_terms()` is missing, accepting lets the person through anyway. A screen about paperwork must never stand between an owner and their shop.
- `/api/auth/me` now separates "this person has no business" from "the business could not be read". A failed read shows a plain message with a Try again button instead of sending a perfectly good account off to create a second one.

## Removing a business

- Only the super admin, with two-step verification, and only after typing the business name exactly. The server checks the name against the database, not against anything the browser sends.
- The business row goes first: every table under it cascades, so no products, stock, sales, customers or staff rows are left pointing at a business that is gone. The logins belonging to it are then deleted, so nobody is left with a sign-in that leads nowhere.
- Deleting by hand in the Supabase tables only ever removes one side. `supabase/cleanup-orphans.sql` lists both kinds of leftovers and has the statements to clear them.
