-- Scent City Perfumes Thika: wholesale oil prices, bulk price and one stock count per oil.
-- Run AFTER security-patch-16.sql. Safe to run twice. Only touches this business.
do $$
declare bid uuid := '804ed32b-eb36-4cf6-a1aa-6c422ef5fffb';
begin
  -- retail oils hold the stock; warn at 100 ml
  update products set track_stock = true, low_stock_level = 100
    where business_id = bid and category = 'Perfume Oils';
  -- wholesale oils: 10 per ml, 9 per ml from 50 ml, poured from the retail oil's stock
  update products w set price = 10, bulk_min = 50, bulk_price = 9, track_stock = false, low_stock_level = 100,
         stock_of = r.id
    from products r
   where w.business_id = bid and w.category = 'Wholesale Oils'
     and r.business_id = bid and r.category = 'Perfume Oils'
     and (r.name = regexp_replace(w.name, ' \(Wholesale\)$', '')
          or r.name = regexp_replace(w.name, ' \(Wholesale\)$', '') || ' Oil');   -- Teriaq Intense Oil
end $$;

-- check: every wholesale oil should show its retail oil
select w.name, w.price, w.bulk_min, w.bulk_price, r.name as sells_from
  from products w left join products r on r.id = w.stock_of
 where w.business_id = '804ed32b-eb36-4cf6-a1aa-6c422ef5fffb' and w.category = 'Wholesale Oils'
 order by (r.id is null) desc, w.name;
