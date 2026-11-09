-- Patch 11: WhatsApp e-receipts. Safe to run twice.
-- The owner turns e-receipts on (at signup or in Settings) and brands them: the shop's WhatsApp number,
-- a logo, an accent colour, the thank-you message, one extra link, and whether "Powered by Uzaa" shows.
-- The receipt link itself needs no table: it is signed by the server and works for good.
alter table businesses add column if not exists ereceipt_enabled boolean not null default false;
alter table businesses add column if not exists ereceipt_whatsapp text not null default '';
alter table businesses add column if not exists ereceipt_message text not null default '';
alter table businesses add column if not exists ereceipt_color text not null default '#0b5c87';
alter table businesses add column if not exists ereceipt_logo text not null default '';
alter table businesses add column if not exists ereceipt_link_label text not null default '';
alter table businesses add column if not exists ereceipt_link_url text not null default '';
alter table businesses add column if not exists ereceipt_powered boolean not null default true;

alter table businesses drop constraint if exists businesses_ereceipt_chk;
alter table businesses add constraint businesses_ereceipt_chk check (
  length(ereceipt_whatsapp) <= 20
  and length(ereceipt_message) <= 1000
  and ereceipt_color ~ '^#[0-9a-fA-F]{6}$'
  and (ereceipt_logo = '' or (ereceipt_logo ~ '^data:image/(png|jpeg|webp);base64,' and length(ereceipt_logo) <= 120000))
  and length(ereceipt_link_label) <= 60
  and (ereceipt_link_url = '' or (ereceipt_link_url ~ '^https?://' and length(ereceipt_link_url) <= 300))
);
