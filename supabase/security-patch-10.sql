-- Patch 10: quick look-up of a barcode across all shops, so a name one shop saved can be suggested to the next
-- (only the name, unit and category are suggested; never prices or stock). Safe to run twice.
create index if not exists products_barcode_idx on products(barcode) where barcode is not null and barcode <> '';
