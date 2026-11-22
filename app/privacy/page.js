import Link from 'next/link';

export const metadata = {
  title: 'Privacy policy | Uzaa POS',
  description: 'How The Biziirise Solutions handles personal data in Uzaa POS.',
};

// Draft for the owner's review. Plain words, in line with the terms of service and the Data Protection Act, 2019.
export default function Privacy() {
  return (
    <main className="legal">
      <p className="muted small"><Link href="/">Back to Uzaa</Link></p>
      <h1>Privacy policy</h1>
      <p className="muted">In force from 22 November 2026.</p>

      <p>
        Uzaa POS is provided by The Biziirise Solutions, Norfolk Towers, Kijabe Street, Nairobi. This page explains
        what personal data we hold, why, and your rights under the Data Protection Act, 2019.
      </p>

      <h2>1. What we collect</h2>
      <p>
        For you and your staff: name, email address, phone number if given, role, and sign-in records (time, device
        and IP address) to keep accounts secure. If you sign in with Google, Google shares your name, email address
        and profile picture with us. We do not get your Google password or anything else in your Google account.
      </p>
      <p>
        For your business: the products, prices, stock, sales, expenses and settings you record. If you record your
        own customers (for example for credit, loyalty or e-receipts), you decide what is recorded and we hold it
        for you on your instructions only.
      </p>
      <p>Payments for Uzaa are handled by Paystack. We do not see or store card numbers or M-Pesa PINs.</p>

      <h2>2. Why we use it</h2>
      <p>
        To run your account and the service, keep it secure, send you service messages (receipts, alerts, billing),
        give support, and meet legal duties. We do not sell personal data and we do not use it for advertising.
      </p>

      <h2>3. Who we share it with</h2>
      <p>
        Only the providers we need to run Uzaa: hosting and database (Vercel, Supabase), email delivery, payments
        (Paystack) and Google for sign-in. Some of them store data outside Kenya under appropriate safeguards. We
        also share data where the law requires it.
      </p>

      <h2>4. How long we keep it</h2>
      <p>
        While your account is active. If you leave, you may ask for a copy within 60 days of your last day; after
        that we may delete it, except records the law requires us to keep.
      </p>

      <h2>5. Your rights</h2>
      <p>
        You may ask to see, correct or delete your personal data, object to its use, or ask for a copy. Write to
        hello@biziirise.com. If you are not satisfied, you may complain to the Office of the Data Protection
        Commissioner.
      </p>

      <h2>6. Security</h2>
      <p>
        Data is sent over encrypted connections, sign-in cookies cannot be read by scripts, each business can only
        see its own data, and the admin account uses a second sign-in step.
      </p>

      <p className="muted small" style={{ marginTop: 32 }}>
        See also our <Link href="/terms">terms of service</Link>. The Biziirise Solutions, Norfolk Towers, Kijabe
        Street, Nairobi. hello@biziirise.com. Tel 0141 025 616.
      </p>
    </main>
  );
}
