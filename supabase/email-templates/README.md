# Uzaa branded emails

Six templates, same look: Uzaa logo, cream background, blue button, Biziirise footer.

| File | Supabase template | Subject line |
|---|---|---|
| confirm-signup.html | Confirm sign up | Confirm your Uzaa account |
| reset-password.html | Reset password | Reset your Uzaa password |
| magic-link.html | Magic link | Your Uzaa sign-in link |
| invite.html | Invite user | You have been invited to Uzaa |
| change-email.html | Change email address | Confirm your new Uzaa email |
| reauthentication.html | Reauthentication | Your Uzaa confirmation code |

## 1. Put the templates in Supabase
Authentication > Emails (Email Templates). For each row above, open the template, set the subject, and paste the whole file into the message body. Save.

The logo loads from https://uzaa.co.ke/brand/email-logo.png, so deploy the site first.

## 2. Send from your own address (needed, or the emails still say Supabase)
Supabase's built-in sender is limited to a few emails an hour. Use your own SMTP, for example Resend:

1. Resend > Domains > add uzaa.co.ke, then add the DNS records it shows (SPF, DKIM) at your domain host. Wait until it says Verified.
2. Resend > API Keys > create a key.
3. Supabase > Authentication > Emails > SMTP Settings > turn on Custom SMTP:
   - Sender email: noreply@uzaa.co.ke
   - Sender name: Uzaa
   - Host: smtp.resend.com
   - Port: 465
   - Username: resend
   - Password: your Resend API key
4. Send yourself a test: use Forgot password, or create a test user.

## 3. Confirm email on or off
- Off (default now): new owners get in straight away. Fastest for onboarding.
- On: Authentication > Providers > Email > Confirm email. The signup page then tells the owner to check their email, and finishes setting up the business after they confirm and sign in.

## 4. URLs
Authentication > URL Configuration: set Site URL to https://uzaa.co.ke and add https://uzaa.co.ke/** to Redirect URLs. Without this, the links in emails can send people to the wrong place.
