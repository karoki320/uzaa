import Link from 'next/link';
import { TERMS_DATE, TERMS_VERSION } from '@/lib/terms';

export const metadata = {
  title: 'Terms of service | Uzaa POS',
  description: 'The terms under which The Biziirise Solutions provides Uzaa POS to businesses in Kenya.',
};

export default function Terms() {
  return (
    <main className="legal">
      <p className="muted small"><Link href="/">Back to Uzaa</Link></p>
      <h1>Terms of service</h1>
      <p className="muted">Version {TERMS_VERSION}, in force from {TERMS_DATE}.</p>

      <p>
        These terms are an agreement between you, the business using Uzaa, and The Biziirise Solutions of Norfolk
        Towers, Kijabe Street, Nairobi, who provide it. By ticking the box when you create an account, or by
        continuing to use Uzaa, you accept them. If you are accepting on behalf of a business, you confirm you are
        allowed to do so.
      </p>

      <h2>1. What Uzaa is</h2>
      <p>
        Uzaa is a point of sale you use through a web browser. It records your sales, keeps your stock and staff,
        prints receipts to a supported printer, and shows you reports. We may add, change or remove features as the
        product improves. If we remove something you depend on, we will tell you first.
      </p>

      <h2>2. Your account</h2>
      <p>
        You give us a business name, your name and an email address. You are responsible for who you let into your
        account and for what they do in it. Keep your password to yourself, use the two-step verification we provide,
        and tell us at once if you think someone else has got in. Each person who uses Uzaa must have their own
        login; sharing one login between staff makes your own records useless to you.
      </p>
      <p>
        You must be at least 18 years old and the business you register must be real and lawful.
      </p>

      <h2>3. Fees</h2>
      <p>
        Uzaa is paid for every three months, in advance, at the price on our website on the day you pay. Hardware,
        and any setup or training we agree to, is charged separately and is yours once paid for.
      </p>
      <p>
        If a payment is late we may suspend the account after telling you. A suspended account cannot sell, but your
        records stay safe and come back when you pay. We may change our prices, and we will give you at least 30
        days notice before a change affects you. Part of a quarter already paid for is not refunded if you stop
        early, unless we have failed to provide the service.
      </p>

      <h2>4. Your data belongs to you</h2>
      <p>
        Everything you record in Uzaa, your products, prices, sales, stock, staff and customers, remains yours. We
        hold it so that we can run the service for you. We do not sell it, and we do not share it with anyone else
        except where we must to run the service (our hosting and email providers), or where the law requires it.
      </p>
      <p>
        You can download your sales to a spreadsheet at any time. If you leave, you may ask us for a copy of your
        data within 60 days of your last day; after that we may delete it.
      </p>
      <p>
        Where you record your own customers, for example their name and phone number for credit, you are responsible
        for them under the Data Protection Act, 2019. Collect only what you need, tell people what you are recording
        and why, keep it to yourself, and use their number only for your own business with them. We handle that
        information on your instructions and for no other purpose.
      </p>

      <h2>5. Using Uzaa properly</h2>
      <p>
        Do not use Uzaa to break the law, to record sales you intend to hide from the authorities, to send unwanted
        messages, or to store anything that is not yours to store. Do not try to get into another business account,
        to work around the limits we set, or to resell Uzaa as your own. We may suspend an account that does any of
        these things.
      </p>

      <h2>6. Tax and receipts</h2>
      <p>
        Uzaa records your sales and prints receipts, but the way you meet your tax obligations is your own
        responsibility. If you need KRA eTIMS, ask us and we will tell you what it involves for your business.
      </p>

      <h2>7. Credit sales</h2>
      <p>
        If you switch credit sales on, Uzaa keeps the record of who owes you what. Deciding who may take goods on
        credit, and collecting what you are owed, is entirely your business. We are not a party to it.
      </p>

      <h2>8. What we promise, and what we do not</h2>
      <p>
        We work to keep Uzaa available and quick, and we keep backups. We cannot promise it will never be down: the
        internet, a hosting provider, a power cut or your own device can all interrupt it. Uzaa can keep selling
        while your network is down and upload those sales afterwards, but you should still check your figures.
      </p>
      <p>
        We are not liable for business you lose, profit you miss, or data you lose where the loss was not our fault.
        Where we are liable, our liability over any twelve months is limited to what you paid us in those twelve
        months. Nothing here limits liability that the law does not allow us to limit.
      </p>

      <h2>9. Support</h2>
      <p>
        Reach us on WhatsApp at 0141 025 616 or by email at hello@biziirise.com. We answer during normal working
        hours in Nairobi and we aim to reply the same working day.
      </p>

      <h2>10. Ending it</h2>
      <p>
        You may stop using Uzaa at any time by telling us before your next quarter begins. We may end this agreement
        with 30 days notice, or at once if you break these terms seriously or do not pay. We will give you the
        chance to take your data with you.
      </p>

      <h2>11. Changes to these terms</h2>
      <p>
        We may update these terms. If we change something that matters, we will show you the new version and ask you
        to accept it the next time you sign in.
      </p>

      <h2>12. Law</h2>
      <p>
        These terms are governed by the laws of Kenya. If we disagree, we will first try in good faith to settle it
        between ourselves. If that fails, the courts of Kenya decide.
      </p>

      <p className="muted small" style={{ marginTop: 32 }}>
        The Biziirise Solutions, Norfolk Towers, Kijabe Street, Nairobi. hello@biziirise.com. Tel 0141 025 616.
      </p>
    </main>
  );
}
