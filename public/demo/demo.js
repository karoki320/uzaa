/* Uzaa live demo. Everything runs in the browser with sample data. Nothing is saved or sent. */
(function () {
  'use strict';
  var root = document.getElementById('dm-root');
  if (!root) return;

  /* ---------- helpers ---------- */
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var fmt = function (n) { return Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 }); };
  var q$ = function (sel) { return root.querySelector(sel); };
  var S = null, roleNow = 'owner', typeNow = 'retail';
  var money = function (n) { return S.biz.currency + ' ' + fmt(n); };
  var nid = function (p) { S.n += 1; return p + S.n; };

  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function monday(d) { var x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }
  function dayKey(ts) {
    var x = new Date(ts);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }
  function fmtTime(ts) { return new Date(ts).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }); }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---------- sample businesses ---------- */
  var NAV = [
    { k: 'sell', l: 'Sell', r: 'owner manager cashier' },
    { k: 'sales', l: 'Sales', r: 'owner manager cashier' },
    { k: 'products', l: 'Products', r: 'owner manager' },
    { k: 'stock', l: 'Stock', r: 'owner manager' },
    { k: 'reports', l: 'Reports', r: 'owner manager' },
    { k: 'branches', l: 'Branches', r: 'owner' },
    { k: 'staff', l: 'Staff', r: 'owner' },
    { k: 'settings', l: 'Settings', r: 'owner' }
  ];
  var ROLE_NOTE = {
    owner: 'Owner sees everything: every branch, reports, staff and settings.',
    manager: 'Manager sees sales, products, stock and reports. No staff or settings.',
    cashier: 'Cashier sees only the sell screen and their own sales, in their own branch.'
  };
  var PRESETS = {
    retail: { label: 'Retail shop / duka', item: 'Product', fields: [] },
    pharmacy: { label: 'Pharmacy', item: 'Medicine', fields: [{ key: 'expiry_date', label: 'Expiry date', type: 'date' }, { key: 'batch_no', label: 'Batch number', type: 'text' }] },
    restaurant: { label: 'Restaurant / cafe', item: 'Menu item', fields: [] },
    salon: { label: 'Salon / services', item: 'Service', fields: [] },
    hardware: { label: 'Hardware', item: 'Item', fields: [{ key: 'unit', label: 'Unit', type: 'text' }] },
    other: { label: 'Other', item: 'Product', fields: [] }
  };
  // item: [name, category, price, cost, tracked(1/0), low-stock level, pack size]
  var TYPES = {
    retail: {
      label: 'Shop', biz: 'Mama Njeri Stores', domain: 'mamanjeri.example', code: 1, volume: 22, tax: 0, item: 'Product',
      fields: [{ key: 'pack', label: 'Pack size', type: 'text' }], payW: [0.4, 0.45, 0.15],
      header: 'Tom Mboya Street, Nairobi\nPIN P051234567A', footer: 'Thank you for shopping with us.\nKaribu tena!',
      people: ['Njeri Wanjiru', 'Peter Kamau', 'Faith Achieng', 'Brian Otieno'],
      branches: [['Tom Mboya Branch', 'Tom Mboya Street, Nairobi', '0722 000 111'], ['Westlands Branch', 'Woodvale Grove, Westlands', '0722 000 222'], ['Thika Road Branch', 'Roysambu, Thika Road', '0722 000 333']],
      items: [
        ['Maize flour 2kg', 'Flour', 150, 128, 1, 20, '2 kg'], ['Wheat flour 2kg', 'Flour', 190, 165, 1, 15, '2 kg'],
        ['Sugar 1kg', 'Sugar', 180, 158, 1, 25, '1 kg'], ['Cooking oil 1L', 'Oils', 330, 295, 1, 12, '1 L'],
        ['Rice 1kg', 'Cereals', 260, 225, 1, 15, '1 kg'], ['Bread 400g', 'Bakery', 65, 55, 1, 15, '400 g'],
        ['Fresh milk 500ml', 'Dairy', 60, 51, 1, 20, '500 ml'], ['Tea leaves 250g', 'Beverages', 130, 108, 1, 12, '250 g'],
        ['Salt 500g', 'Spices', 40, 31, 1, 20, '500 g'], ['Soap bar 175g', 'Household', 95, 76, 1, 20, '175 g'],
        ['Washing powder 500g', 'Household', 130, 108, 1, 12, '500 g'], ['Toothpaste 100g', 'Personal care', 150, 122, 1, 10, '100 g'],
        ['Soda 500ml', 'Beverages', 60, 47, 1, 24, '500 ml'], ['Bottled water 1L', 'Beverages', 70, 52, 1, 24, '1 L'],
        ['Tissue paper 10pk', 'Household', 300, 255, 1, 8, '10 pk'], ['Eggs tray of 30', 'Dairy', 520, 470, 1, 6, '30 pcs'],
        ['Spaghetti 500g', 'Pasta', 120, 98, 1, 12, '500 g'], ['Matchbox pack', 'Household', 20, 14, 1, 30, '10 pcs'],
        ['Exercise book 96pg', 'Stationery', 50, 36, 1, 20, '96 pg'], ['Biscuits 200g', 'Snacks', 90, 70, 1, 15, '200 g']
      ]
    },
    pharmacy: {
      label: 'Pharmacy', biz: 'Afya Plus Pharmacy', domain: 'afyaplus.example', code: 2, volume: 17, tax: 0, item: 'Medicine',
      fields: PRESETS.pharmacy.fields, payW: [0.3, 0.45, 0.25],
      header: 'Moi Avenue, Nairobi\nPharmacy licence no. on display', footer: 'Get well soon.\nAsante, karibu tena.',
      people: ['Amina Mwende', 'Joseph Kariuki', 'Lucy Wambui', 'Daniel Ochieng'],
      branches: [['CBD Branch', 'Moi Avenue, Nairobi', '0733 000 111'], ['Westlands Branch', 'Mpaka Road, Westlands', '0733 000 222']],
      items: [
        ['Paracetamol 500mg x16', 'Pain relief', 80, 52, 1, 20], ['Ibuprofen 400mg x10', 'Pain relief', 120, 80, 1, 15],
        ['Cough syrup 100ml', 'Cold and flu', 220, 160, 1, 10], ['Lozenges x16', 'Cold and flu', 140, 95, 1, 12],
        ['Oral rehydration salts', 'Digestive', 30, 18, 1, 30], ['Antacid tablets x12', 'Digestive', 90, 60, 1, 15],
        ['Vitamin C 1000mg x20', 'Vitamins', 450, 320, 1, 8], ['Multivitamin x30', 'Vitamins', 650, 470, 1, 8],
        ['Zinc tablets x10', 'Vitamins', 180, 120, 1, 10], ['Hand sanitizer 100ml', 'Hygiene', 150, 100, 1, 15],
        ['Face masks 50pk', 'Hygiene', 400, 280, 1, 6], ['Plasters 20pk', 'First aid', 100, 65, 1, 12],
        ['Bandage roll', 'First aid', 60, 38, 1, 15], ['Digital thermometer', 'Devices', 550, 400, 1, 4],
        ['Eye drops 10ml', 'Eye care', 320, 230, 1, 6]
      ]
    },
    restaurant: {
      label: 'Restaurant', biz: 'Kahawa Corner Cafe', domain: 'kahawacorner.example', code: 3, volume: 30, tax: 16, item: 'Menu item',
      fields: [], payW: [0.3, 0.5, 0.2],
      header: 'Kimathi Street, Nairobi\nPIN P051234567A', footer: 'Asante sana for dining with us.\nKaribu tena!',
      people: ['Grace Mutheu', 'Samuel Njoroge', 'Mercy Atieno', 'Hassan Ali'],
      branches: [['Kahawa Corner Main', 'Kimathi Street, Nairobi', '0711 000 111'], ['Kahawa Corner Karen', 'Karen Road, Karen', '0711 000 222']],
      items: [
        ['Chips and chicken', 'Mains', 650, 380, 0, 0], ['Ugali and beef stew', 'Mains', 420, 230, 0, 0],
        ['Pilau', 'Mains', 380, 200, 0, 0], ['Chicken burger', 'Mains', 550, 310, 0, 0],
        ['Nyama choma 1/2 kg', 'Grill', 900, 560, 0, 0], ['Chapati x2', 'Sides', 60, 25, 0, 0],
        ['Garden salad', 'Sides', 300, 140, 0, 0], ['Beef samosa', 'Snacks', 50, 28, 0, 0],
        ['Mandazi x3', 'Snacks', 40, 18, 0, 0], ['Fresh juice', 'Drinks', 200, 90, 0, 0],
        ['Tea', 'Drinks', 60, 20, 0, 0], ['Coffee', 'Drinks', 150, 55, 0, 0],
        ['Soda 500ml', 'Drinks', 80, 55, 1, 24], ['Bottled water 500ml', 'Drinks', 60, 35, 1, 24]
      ]
    },
    salon: {
      label: 'Salon', biz: 'Glow Studio Salon', domain: 'glowstudio.example', code: 4, volume: 9, tax: 0, item: 'Service',
      fields: [], payW: [0.25, 0.6, 0.15],
      header: 'Argwings Kodhek Road, Kilimani\nBook on 0700 000 111', footer: 'Thank you for choosing Glow Studio.\nSee you again soon!',
      people: ['Esther Wangari', 'Ruth Chebet', 'Linet Akinyi', 'Joy Nyambura'],
      branches: [['Glow Studio Kilimani', 'Argwings Kodhek Road', '0700 000 111'], ['Glow Studio Lavington', 'James Gichuru Road', '0700 000 222']],
      items: [
        ['Haircut', 'Hair', 500, 100, 0, 0], ['Blow-dry', 'Hair', 800, 200, 0, 0], ['Braids (medium)', 'Hair', 2500, 800, 0, 0],
        ['Hair treatment', 'Hair', 1500, 600, 0, 0], ['Hair colour', 'Hair', 3000, 1200, 0, 0], ['Beard trim', 'Barber', 300, 50, 0, 0],
        ['Manicure', 'Nails', 700, 200, 0, 0], ['Pedicure', 'Nails', 900, 250, 0, 0], ['Facial', 'Skin', 1800, 600, 0, 0],
        ['Shampoo 250ml', 'Products', 650, 420, 1, 8], ['Conditioner 250ml', 'Products', 700, 460, 1, 8], ['Hair oil 100ml', 'Products', 450, 280, 1, 10]
      ]
    }
  };

  /* ---------- build the sample data for one business ---------- */
  function build(type) {
    var T = TYPES[type], R = rng(hash(type));
    S = { type: type, role: roleNow, tab: 'sell', n: 0 };
    S.biz = { name: T.biz, item: T.item, currency: 'KES', tax: T.tax, fields: T.fields.map(function (f) { return Object.assign({}, f); }), pay: ['Cash', 'M-Pesa', 'Card'], header: T.header, footer: T.footer };
    S.branches = T.branches.map(function (b) { return { id: nid('b'), name: b[0], address: b[1], phone: b[2] }; });
    var b0 = S.branches[0].id, b1 = (S.branches[1] || S.branches[0]).id;
    function person(name, role, br) {
      return { id: nid('u'), name: name, email: name.split(' ')[0].toLowerCase() + '@' + T.domain, role: role, branch: br, active: true };
    }
    S.staff = [person(T.people[0], 'owner', b0), person(T.people[1], 'manager', b1), person(T.people[2], 'cashier', b0), person(T.people[3], 'cashier', b1)];
    S.persona = { owner: S.staff[0].id, manager: S.staff[1].id, cashier: S.staff[2].id };

    S.products = T.items.map(function (it, i) {
      var custom = {};
      if (type === 'retail') custom.pack = it[6] || '';
      if (type === 'pharmacy') {
        var d = new Date(); d.setMonth(d.getMonth() + 6 + Math.floor(R() * 24));
        custom.expiry_date = d.toISOString().slice(0, 10);
        custom.batch_no = 'B' + (2400 + Math.floor(R() * 600));
      }
      return {
        id: nid('p'), name: it[0], category: it[1], price: it[2], cost: it[3], track: !!it[4], low: it[5],
        barcode: it[4] ? ('6161' + T.code + String(i + 1).padStart(3, '0')).padEnd(13, '0') : '', custom: custom, active: true
      };
    });

    S.stock = {};
    S.products.forEach(function (p) {
      if (!p.track) return;
      S.stock[p.id] = {};
      S.branches.forEach(function (b) {
        var q = Math.round(p.low * (1.2 + R() * 5));
        if (R() < 0.12) q = Math.floor(p.low * R() * 0.9);
        S.stock[p.id][b.id] = q;
      });
    });

    S.moves = [];
    var tr = S.products.filter(function (p) { return p.track; });
    var seeds = [[2, 50, 'Received stock'], [5, -3, 'Damaged or expired'], [26, 24, 'Received stock'], [29, 48, 'Received stock'], [50, -2, 'Stock count correction']];
    S.branches.slice(0, 2).forEach(function (b, bi) {
      seeds.slice(0, bi === 0 ? 5 : 3).forEach(function (s, i) {
        S.moves.push({ ts: Date.now() - s[0] * 3600e3, pid: tr[(i * 3 + bi) % tr.length].id, bid: b.id, change: s[1], reason: s[2] });
      });
    });
    S.moves.sort(function (a, b) { return b.ts - a.ts; });

    // 35 days of sales history
    var now = Date.now(), t0 = startOfDay(now).getTime();
    var pw = S.products.map(function (p, i) { return 1 / (1 + i * 0.22); });
    var pwSum = pw.reduce(function (a, b) { return a + b; }, 0);
    var F = [1.1, 0.8, 0.85, 0.85, 0.95, 1.25, 1.45];
    function pickProduct() {
      var x = R() * pwSum;
      for (var i = 0; i < pw.length; i++) { x -= pw[i]; if (x <= 0) return S.products[i]; }
      return S.products[0];
    }
    function makeSale(ts, bid, cashier) {
      var nl = 1 + Math.floor(R() * 3.3), items = [], seen = {}, sub = 0;
      for (var j = 0; j < nl; j++) {
        var p = pickProduct();
        if (seen[p.id]) continue;
        seen[p.id] = 1;
        var q = (type === 'salon' && !p.track) ? 1 : (R() < 0.75 ? 1 : (R() < 0.7 ? 2 : 3));
        items.push({ pid: p.id, name: p.name, qty: q, price: p.price, cost: p.cost });
        sub += q * p.price;
      }
      var tax = Math.round(sub * T.tax) / 100, total = sub + tax;
      var x = R(), acc = 0, mi = T.payW.length - 1;
      for (var m = 0; m < T.payW.length; m++) { acc += T.payW[m]; if (x <= acc) { mi = m; break; } }
      var method = S.biz.pay[mi];
      return { id: '', no: 0, ts: ts, bid: bid, cashier: cashier, method: method, items: items, subtotal: sub, discount: 0, tax: tax, total: total, paid: method === 'Cash' ? Math.ceil(total / 50) * 50 : total };
    }
    var list = [];
    for (var d = 34; d >= 0; d--) {
      var day0 = t0 - d * 86400e3;
      var f = F[new Date(day0).getDay()];
      S.branches.forEach(function (b, bi) {
        var cnt = Math.round(T.volume * [1, 0.72, 0.45, 0.4][bi] * f * (0.85 + R() * 0.3));
        if (d === 0) cnt = Math.min(cnt, 3 + Math.floor((now - t0) / 3600e3 * 1.6));
        var inB = S.staff.filter(function (u) { return u.branch === b.id; });
        if (!inB.length) inB = [S.staff[3]];
        for (var k = 0; k < cnt; k++) {
          var ts = d === 0 ? t0 + R() * (now - t0) * 0.97 : day0 + 7 * 3600e3 + R() * 12 * 3600e3;
          list.push(makeSale(ts, b.id, inB[Math.floor(R() * inB.length)].id));
        }
      });
    }
    list.sort(function (a, b) { return a.ts - b.ts; });
    list.forEach(function (s, i) { s.no = 1001 + i; s.id = 's' + s.no; });
    S.sales = list;
    S.nextNo = 1001 + list.length;

    S.sell = { branch: null, cart: [], q: '', discount: '', method: 'Cash', paid: '' };
    S.salesDay = dayKey(now); S.salesBranch = '';
    S.stBranch = null; S.stQ = ''; S.stLow = false; S.pQ = '';
    S.rep = { preset: 'last7', branch: '' };
    S.draft = null;
  }

  /* ---------- lookups ---------- */
  function me() { var id = S.persona[S.role]; return S.staff.filter(function (u) { return u.id === id; })[0]; }
  function branchOf(id) { return S.branches.filter(function (b) { return b.id === id; })[0]; }
  function prod(id) { return S.products.filter(function (p) { return p.id === id; })[0]; }
  function staffName(id) { var u = S.staff.filter(function (x) { return x.id === id; })[0]; return u ? u.name : 'Unknown'; }
  function qty(pid, bid) { var s = S.stock[pid]; return s && s[bid] ? s[bid] : 0; }
  function setQty(pid, bid, v) { if (!S.stock[pid]) S.stock[pid] = {}; S.stock[pid][bid] = v; }
  function allowed(tab) { return NAV.some(function (n) { return n.k === tab && n.r.indexOf(S.role) >= 0; }); }
  function branchOptions(sel, withAll) {
    return (withAll ? '<option value="">All branches</option>' : '') + S.branches.map(function (b) {
      return '<option value="' + b.id + '"' + (b.id === sel ? ' selected' : '') + '>' + esc(b.name) + '</option>';
    }).join('');
  }

  /* ---------- shell ---------- */
  function shell() {
    var seg = Object.keys(TYPES).map(function (k) {
      return '<button type="button" data-a="type" data-v="' + k + '" aria-pressed="' + (k === typeNow) + '">' + TYPES[k].label + '</button>';
    }).join('');
    var roles = ['owner', 'manager', 'cashier'].map(function (r) {
      return '<button type="button" data-a="role" data-v="' + r + '" aria-pressed="' + (r === roleNow) + '">' + r.charAt(0).toUpperCase() + r.slice(1) + '</button>';
    }).join('');
    root.innerHTML =
      '<div class="dm-ctl">' +
        '<div><span class="dm-lab">1. Pick a business</span><div class="dm-seg" role="group" aria-label="Business type">' + seg + '</div></div>' +
        '<div><span class="dm-lab">2. View as</span><div class="dm-seg" role="group" aria-label="View as">' + roles + '</div></div>' +
        '<button type="button" class="dm-btn" data-a="reset">Reset demo</button>' +
      '</div>' +
      '<p class="dm-note" id="dm-rolenote"></p>' +
      '<p class="dm-hint"><b>Try this:</b> tap a few items or press Simulate scan, charge the sale, then open Stock and Reports to see the numbers move. Switch to Cashier to see how little they can reach.</p>' +
      '<div class="dm-app" id="dm-app"><div class="dm-head" id="dm-head"></div><div class="dm-tabs" id="dm-tabs" role="tablist"></div><div class="dm-page" id="dm-page"></div>' +
      '<div id="dm-modal"></div><div class="dm-toast" id="dm-toast" role="status" hidden></div></div>' +
      '<div class="dm-cta"><p>Want this set up for your business?</p><a id="dm-wa" rel="noopener" href="#">Talk to us on WhatsApp</a></div>';
  }
  function syncControls() {
    var b = root.querySelectorAll('[data-a="type"]'), i;
    for (i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', String(b[i].dataset.v === typeNow));
    b = root.querySelectorAll('[data-a="role"]');
    for (i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', String(b[i].dataset.v === roleNow));
    q$('#dm-rolenote').textContent = ROLE_NOTE[roleNow];
    var msg = 'Hello, I tried the Uzaa demo (' + TYPES[typeNow].label.toLowerCase() + ') and would like to set it up for my business.';
    q$('#dm-wa').href = 'https://wa.me/254141025616?text=' + encodeURIComponent(msg);
  }
  var toastT = 0;
  function toast(m) {
    var t = q$('#dm-toast'); t.textContent = m; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function openModal(title, html) {
    q$('#dm-modal').innerHTML = '<div class="dm-overlay"><div class="dm-modal" role="dialog" aria-modal="true">' +
      (title ? '<div class="dm-row dm-between" style="margin-bottom:12px"><h2 style="margin:0;font-size:20px">' + esc(title) + '</h2><button type="button" class="dm-btn sm" data-a="mclose">Close</button></div>' : '') +
      html + '</div></div>';
    var f = q$('#dm-modal input:not([type=checkbox]), #dm-modal select');
    if (f && title) f.focus();
  }
  function closeModal() { q$('#dm-modal').innerHTML = ''; }

  function draw() {
    if (!allowed(S.tab)) S.tab = 'sell';
    var p = me(), br = branchOf(p.branch);
    q$('#dm-head').innerHTML = '<div><span class="dm-brand">Uzaa</span> <span class="dm-sub">&nbsp;' + esc(S.biz.name) + (br ? ' / ' + esc(br.name) : '') + '</span></div>' +
      '<div class="dm-who">' + esc(p.name) + ' <span class="dm-badge">' + S.role + '</span></div>';
    var page = q$('#dm-page');
    if (!p.active) {
      q$('#dm-tabs').innerHTML = '';
      page.innerHTML = '<div class="dm-card"><h2>Account unavailable</h2><p>This account was switched off by the owner, so in the real app this person is signed out. Choose Owner under "View as" and switch it back on in Staff.</p></div>';
      return;
    }
    q$('#dm-tabs').innerHTML = NAV.filter(function (n) { return allowed(n.k); }).map(function (n) {
      return '<button type="button" class="dm-tab' + (n.k === S.tab ? ' on' : '') + '" data-a="tab" data-v="' + n.k + '">' + n.l + '</button>';
    }).join('');
    ({ sell: pageSell, sales: pageSales, products: pageProducts, stock: pageStock, reports: pageReports, branches: pageBranches, staff: pageStaff, settings: pageSettings })[S.tab]();
  }

  /* ---------- SELL ---------- */
  function sellBranch() {
    var p = me();
    if (S.role === 'cashier') S.sell.branch = p.branch;
    else if (!S.sell.branch || !branchOf(S.sell.branch)) S.sell.branch = S.role === 'manager' ? p.branch : S.branches[0].id;
    return S.sell.branch;
  }
  function pageSell() {
    var bid = sellBranch();
    var sel = (S.role !== 'cashier' && S.branches.length > 1) ? '<select class="dm-input dm-w200" data-a="sbranch" aria-label="Branch">' + branchOptions(bid) + '</select>' : '';
    q$('#dm-page').innerHTML = '<div class="dm-pos"><div class="dm-sellcol"><div class="dm-row">' +
      '<input id="dm-q" class="dm-input dm-grow" style="font-size:17px" autocomplete="off" aria-label="Scan or search" placeholder="Scan barcode or search...">' +
      '<button type="button" class="dm-btn" data-a="scan">Simulate scan</button>' + sel + '</div>' +
      '<div class="dm-msg" id="dm-msg" aria-live="polite"></div><div class="dm-tiles" id="dm-tiles"></div></div>' +
      '<aside class="dm-card dm-cart" id="dm-cart"></aside></div>';
    q$('#dm-q').value = S.sell.q;
    renderTiles(); renderCart();
  }
  function msg(t, ok) {
    var m = q$('#dm-msg'); if (!m) return;
    m.className = 'dm-msg' + (ok ? ' dm-ok' : t ? ' dm-err' : ''); m.textContent = t || '';
  }
  function filtered() {
    var t = S.sell.q.trim().toLowerCase();
    return S.products.filter(function (p) {
      return p.active && (!t || p.name.toLowerCase().indexOf(t) >= 0 || (p.barcode || '').indexOf(t) >= 0 || (p.category || '').toLowerCase().indexOf(t) >= 0);
    });
  }
  function renderTiles() {
    var el = q$('#dm-tiles'); if (!el) return;
    var bid = S.sell.branch, list = filtered();
    if (!S.products.some(function (p) { return p.active; })) { el.innerHTML = '<div class="dm-muted">Nothing to sell yet. Add something under Products.</div>'; return; }
    el.innerHTML = list.map(function (p) {
      var s = qty(p.id, bid);
      return '<button type="button" class="dm-tile" data-a="add" data-id="' + p.id + '"><b>' + esc(p.name) + '</b><span class="p">' + money(p.price) + '</span>' +
        (p.track ? '<div class="s' + (s <= p.low ? ' dm-warn' : '') + '">' + fmt(s) + ' in stock</div>' : '') + '</button>';
    }).join('') || '<div class="dm-muted">No match.</div>';
  }
  function calc() {
    var sub = 0; S.sell.cart.forEach(function (l) { sub += l.qty * l.price; });
    var disc = Math.max(0, Math.min(Number(S.sell.discount) || 0, sub)), rate = Number(S.biz.tax) || 0;
    var tax = Math.round((sub - disc) * rate) / 100;
    return { sub: sub, disc: disc, tax: tax, rate: rate, total: sub - disc + tax };
  }
  function totalsInner(k) {
    return '<div><span>Subtotal</span><span>' + money(k.sub) + '</span></div>' +
      (k.disc > 0 ? '<div><span>Discount</span><span>-' + money(k.disc) + '</span></div>' : '') +
      (k.tax > 0 ? '<div><span>Tax (' + k.rate + '%)</span><span>' + money(k.tax) + '</span></div>' : '') +
      '<div class="g"><span>Total</span><span>' + money(k.total) + '</span></div>';
  }
  function isCash() { return S.sell.method.toLowerCase() === 'cash'; }
  function renderCart() {
    var el = q$('#dm-cart'); if (!el) return;
    var c = S.sell.cart, bid = S.sell.branch;
    if (S.biz.pay.indexOf(S.sell.method) < 0) S.sell.method = S.biz.pay[0];
    if (!c.length) { el.innerHTML = '<h2>Current sale</h2><p class="dm-muted" style="margin:6px 0 0">Scan or tap an item to start.</p>'; return; }
    var k = calc();
    el.innerHTML = '<h2>Current sale</h2>' + c.map(function (l) {
      var p = prod(l.id), low = p && p.track && qty(l.id, bid) < l.qty;
      return '<div class="dm-line"><div><b>' + esc(l.name) + '</b><div class="dm-sm dm-muted">' + money(l.price) + ' each</div>' +
        (low ? '<div class="dm-sm dm-warn">Only ' + fmt(qty(l.id, bid)) + ' in stock</div>' : '') + '</div>' +
        '<div class="dm-r"><div class="dm-qty"><button type="button" data-a="qm" data-id="' + l.id + '" aria-label="Less">-</button>' +
        '<input class="dm-input" inputmode="decimal" data-a="qty" data-id="' + l.id + '" value="' + l.qty + '" aria-label="Quantity">' +
        '<button type="button" data-a="qp" data-id="' + l.id + '" aria-label="More">+</button></div><div><b>' + money(l.qty * l.price) + '</b></div></div></div>';
    }).join('') +
      '<label class="dm-field" style="margin-top:10px"><span>Discount (' + esc(S.biz.currency) + ')</span><input id="dm-disc" class="dm-input" inputmode="decimal" value="' + esc(S.sell.discount) + '"></label>' +
      '<div class="dm-totals" id="dm-tot">' + totalsInner(k) + '</div>' +
      '<div class="dm-pay">' + S.biz.pay.map(function (m) { return '<button type="button" class="dm-btn' + (m === S.sell.method ? ' on' : '') + '" data-a="pm" data-v="' + esc(m) + '">' + esc(m) + '</button>'; }).join('') + '</div>' +
      (isCash() ? '<label class="dm-field"><span>Cash received</span><input id="dm-paid" class="dm-input" inputmode="decimal" placeholder="' + k.total + '" value="' + esc(S.sell.paid) + '"></label><div id="dm-change" class="dm-ok" style="margin:-6px 0 10px"></div>' : '') +
      '<button type="button" class="dm-btn pri" id="dm-charge" data-a="charge" style="width:100%;font-size:17px">Charge ' + money(k.total) + '</button>' +
      '<button type="button" class="dm-btn sm" data-a="clear" style="width:100%;margin-top:8px">Clear sale</button>';
    updateTotals();
  }
  function updateTotals() {
    var k = calc(), t = q$('#dm-tot'); if (!t) return;
    t.innerHTML = totalsInner(k);
    var ch = q$('#dm-change'), pd = q$('#dm-paid'), paid = Number(S.sell.paid);
    if (ch) ch.textContent = (S.sell.paid !== '' && paid >= k.total) ? 'Change: ' + money(paid - k.total) : '';
    if (pd) pd.placeholder = String(k.total);
    q$('#dm-charge').textContent = 'Charge ' + money(k.total);
  }
  function addToCart(id) {
    var p = prod(id); if (!p) return;
    var l = S.sell.cart.filter(function (x) { return x.id === id; })[0];
    if (l) l.qty += 1; else S.sell.cart.push({ id: id, name: p.name, price: p.price, qty: 1 });
    msg(''); renderCart();
  }
  function scan() {
    var withCode = S.products.filter(function (p) { return p.active && p.barcode; });
    if (!withCode.length) return msg('No item has a barcode yet.');
    var p = withCode[Math.floor(Math.random() * withCode.length)];
    addToCart(p.id); msg('Scanned ' + p.barcode + ': ' + p.name, true);
  }
  function charge() {
    var c = S.sell.cart.filter(function (x) { return x.qty > 0; });
    if (!c.length) return msg('Cart is empty');
    var k = calc(), cash = isCash();
    var paid = cash ? (S.sell.paid === '' ? k.total : Number(S.sell.paid) || 0) : k.total;
    if (cash && S.sell.paid !== '' && paid < k.total) return msg('Amount paid is less than the total');
    var bid = S.sell.branch, no = S.nextNo++;
    var sale = {
      id: 's' + no, no: no, ts: Date.now(), bid: bid, cashier: me().id, method: S.sell.method, subtotal: k.sub, discount: k.disc, tax: k.tax, total: k.total, paid: paid,
      items: c.map(function (l) { var p = prod(l.id); return { pid: l.id, name: l.name, qty: l.qty, price: l.price, cost: p ? p.cost : 0 }; })
    };
    c.forEach(function (l) {
      var p = prod(l.id);
      if (p && p.track) {
        setQty(p.id, bid, qty(p.id, bid) - l.qty);
        S.moves.unshift({ ts: sale.ts, pid: p.id, bid: bid, change: -l.qty, reason: 'Sale #' + no });
      }
    });
    S.sales.push(sale);
    S.sell.cart = []; S.sell.discount = ''; S.sell.paid = ''; S.sell.q = '';
    var qi = q$('#dm-q'); if (qi) qi.value = '';
    renderTiles(); renderCart(); msg('');
    openModal('', receiptHTML(sale) + '<div class="dm-row" style="margin-top:16px"><button type="button" class="dm-btn" data-a="print">Print receipt</button><button type="button" class="dm-btn pri dm-grow" data-a="mclose">New sale</button></div>');
  }
  function receiptHTML(s) {
    var b = branchOf(s.bid), change = Math.max(0, s.paid - s.total);
    return '<div class="dm-receipt"><div class="c"><b>' + esc(S.biz.name) + '</b></div>' +
      (b ? '<div class="c">' + esc(b.name) + '</div>' + (b.address ? '<div class="c">' + esc(b.address) + '</div>' : '') + (b.phone ? '<div class="c">Tel ' + esc(b.phone) + '</div>' : '') : '') +
      (S.biz.header ? '<div class="c" style="white-space:pre-line">' + esc(S.biz.header) + '</div>' : '') + '<hr>' +
      '<div>Receipt #' + s.no + '</div><div>' + fmtTime(s.ts) + '</div><div>Served by ' + esc(staffName(s.cashier)) + '</div><hr>' +
      s.items.map(function (i) { return '<div>' + esc(i.name) + '</div><div class="ln"><span>&nbsp;&nbsp;' + fmt(i.qty) + ' x ' + fmt(i.price) + '</span><span>' + fmt(i.qty * i.price) + '</span></div>'; }).join('') + '<hr>' +
      '<div class="ln"><span>Subtotal</span><span>' + fmt(s.subtotal) + '</span></div>' +
      (s.discount > 0 ? '<div class="ln"><span>Discount</span><span>-' + fmt(s.discount) + '</span></div>' : '') +
      (s.tax > 0 ? '<div class="ln"><span>Tax</span><span>' + fmt(s.tax) + '</span></div>' : '') +
      '<div class="ln"><b>TOTAL ' + esc(S.biz.currency) + '</b><b>' + fmt(s.total) + '</b></div><hr>' +
      '<div class="ln"><span>Paid by ' + esc(s.method) + '</span><span>' + fmt(s.paid) + '</span></div>' +
      (change > 0 ? '<div class="ln"><span>Change</span><span>' + fmt(change) + '</span></div>' : '') + '<hr>' +
      '<div class="c" style="white-space:pre-line">' + esc(S.biz.footer) + '</div><div class="c">Powered by Uzaa</div></div>';
  }

  /* ---------- SALES ---------- */
  function pageSales() {
    var mine = S.role === 'cashier';
    q$('#dm-page').innerHTML = '<div class="dm-row dm-between"><h2>' + (mine ? 'My sales' : 'Sales') + '</h2><div class="dm-row">' +
      '<input type="date" class="dm-input" style="width:170px" data-a="sday" value="' + S.salesDay + '" aria-label="Day">' +
      (!mine && S.branches.length > 1 ? '<select class="dm-input dm-w200" data-a="sbr2" aria-label="Branch">' + branchOptions(S.salesBranch, true) + '</select>' : '') +
      '</div></div><div id="dm-sbody"></div>';
    salesBody();
  }
  function salesBody() {
    var mine = S.role === 'cashier', id = me().id;
    var from = new Date(S.salesDay + 'T00:00:00').getTime(), to = from + 86400e3;
    var rows = S.sales.filter(function (s) { return s.ts >= from && s.ts < to && (!S.salesBranch || s.bid === S.salesBranch) && (!mine || s.cashier === id); })
      .sort(function (a, b) { return b.ts - a.ts; });
    var total = rows.reduce(function (a, s) { return a + s.total; }, 0);
    q$('#dm-sbody').innerHTML = '<div class="dm-kpis"><div class="dm-kpi"><div class="v">' + money(total) + '</div><div class="l">Total for the day</div></div><div class="dm-kpi"><div class="v">' + rows.length + '</div><div class="l">Sales</div></div></div>' +
      '<div class="dm-card dm-tw"><table class="dm-tbl"><thead><tr><th>Receipt</th><th>Time</th><th>Branch</th><th>Cashier</th><th>Paid by</th><th class="n">Total</th><th></th></tr></thead><tbody>' +
      (rows.slice(0, 200).map(function (s) {
        var b = branchOf(s.bid);
        return '<tr><td>#' + s.no + '</td><td>' + fmtTime(s.ts) + '</td><td>' + esc(b ? b.name : '') + '</td><td>' + esc(staffName(s.cashier)) + '</td><td>' + esc(s.method) + '</td><td class="n">' + money(s.total) + '</td><td class="dm-r"><button type="button" class="dm-btn sm" data-a="vsale" data-id="' + s.id + '">View</button></td></tr>';
      }).join('') || '<tr><td colspan="7" class="dm-muted">No sales on this day.</td></tr>') + '</tbody></table></div>';
  }

  /* ---------- PRODUCTS ---------- */
  function pageProducts() {
    var L = S.biz.item;
    q$('#dm-page').innerHTML = '<div class="dm-row dm-between"><div><h2>' + esc(L) + 's</h2><div class="dm-muted dm-sm">' + S.products.length + ' in catalogue</div></div>' +
      '<button type="button" class="dm-btn pri" data-a="padd">Add ' + esc(L.toLowerCase()) + '</button></div>' +
      '<input id="dm-pq" class="dm-input" style="margin:10px 0" placeholder="Search by name, barcode or category" value="' + esc(S.pQ) + '" aria-label="Search">' +
      '<div class="dm-card dm-tw" id="dm-ptbl"></div>';
    productsTable();
  }
  function productsTable() {
    var t = S.pQ.trim().toLowerCase();
    var rows = S.products.filter(function (p) { return !t || p.name.toLowerCase().indexOf(t) >= 0 || (p.barcode || '').indexOf(t) >= 0 || (p.category || '').toLowerCase().indexOf(t) >= 0; });
    q$('#dm-ptbl').innerHTML = '<table class="dm-tbl"><thead><tr><th>Name</th><th>Barcode</th><th>Category</th><th class="n">Price</th><th class="n">Cost</th><th>Status</th><th></th></tr></thead><tbody>' +
      (rows.map(function (p) {
        return '<tr><td><b>' + esc(p.name) + '</b></td><td>' + (esc(p.barcode) || '-') + '</td><td>' + (esc(p.category) || '-') + '</td><td class="n">' + money(p.price) + '</td><td class="n">' + money(p.cost) + '</td>' +
          '<td>' + (p.active ? '<span class="dm-badge">Active</span>' : '<span class="dm-badge red">Hidden</span>') + '</td>' +
          '<td class="dm-r" style="white-space:nowrap"><button type="button" class="dm-btn sm" data-a="pedit" data-id="' + p.id + '">Edit</button> <button type="button" class="dm-btn sm" data-a="phide" data-id="' + p.id + '">' + (p.active ? 'Hide' : 'Show') + '</button></td></tr>';
      }).join('') || '<tr><td colspan="7" class="dm-muted">Nothing here yet.</td></tr>') + '</tbody></table>';
  }
  function productForm(p) {
    var isNew = !p, L = S.biz.item.toLowerCase();
    p = p || { name: '', barcode: '', category: '', price: '', cost: '', track: true, low: 5, custom: {} };
    var cf = S.biz.fields.map(function (f) {
      return '<label class="dm-field"><span>' + esc(f.label) + '</span><input class="dm-input" name="cf_' + esc(f.key) + '" type="' + (f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text') + '" value="' + esc(p.custom[f.key] || '') + '"></label>';
    }).join('');
    openModal((isNew ? 'Add ' : 'Edit ') + L,
      '<form data-form="product" data-id="' + (isNew ? '' : p.id) + '">' +
      '<label class="dm-field"><span>Name</span><input class="dm-input" name="name" required value="' + esc(p.name) + '"></label>' +
      '<label class="dm-field"><span>Barcode (scan it here)</span><input class="dm-input" name="barcode" value="' + esc(p.barcode) + '"></label>' +
      '<label class="dm-field"><span>Category</span><input class="dm-input" name="category" value="' + esc(p.category) + '"></label>' +
      '<div class="dm-row"><label class="dm-field dm-grow"><span>Selling price</span><input class="dm-input" name="price" required inputmode="decimal" value="' + esc(p.price) + '"></label>' +
      '<label class="dm-field dm-grow"><span>Cost price</span><input class="dm-input" name="cost" inputmode="decimal" value="' + esc(p.cost) + '"></label></div>' + cf +
      '<label class="dm-row" style="margin-bottom:12px"><input type="checkbox" name="track"' + (p.track ? ' checked' : '') + '> Track stock for this ' + esc(L) + '</label>' +
      '<div class="dm-row"><label class="dm-field dm-grow"><span>Low stock warning at</span><input class="dm-input" name="low" inputmode="decimal" value="' + esc(p.low) + '"></label>' +
      (isNew ? '<label class="dm-field dm-grow"><span>Opening stock</span><input class="dm-input" name="opening" inputmode="decimal"></label>' : '') + '</div>' +
      (isNew && S.branches.length > 1 ? '<label class="dm-field"><span>Opening stock goes to</span><select class="dm-input" name="obranch">' + branchOptions(S.branches[0].id) + '</select></label>' : '') +
      '<div class="dm-err" id="dm-ferr"></div><button class="dm-btn pri" style="width:100%">Save</button></form>');
  }
  function saveProduct(form) {
    var fd = new FormData(form), id = form.dataset.id, name = (fd.get('name') || '').trim(), code = (fd.get('barcode') || '').trim();
    var err = q$('#dm-ferr');
    if (!name) { err.textContent = 'Enter a name'; return; }
    if (code && S.products.some(function (x) { return x.barcode === code && x.id !== id; })) { err.textContent = 'That barcode is already used by another item'; return; }
    var custom = {}; S.biz.fields.forEach(function (f) { custom[f.key] = fd.get('cf_' + f.key) || ''; });
    var p = id ? prod(id) : { id: nid('p'), active: true };
    Object.assign(p, { name: name, barcode: code, category: (fd.get('category') || '').trim(), price: Number(fd.get('price')) || 0, cost: Number(fd.get('cost')) || 0, track: fd.get('track') === 'on', low: Number(fd.get('low')) || 0, custom: custom });
    if (!id) {
      S.products.push(p);
      var o = Number(fd.get('opening')) || 0;
      if (p.track && o > 0) {
        var bid = fd.get('obranch') || S.branches[0].id;
        setQty(p.id, bid, o); S.moves.unshift({ ts: Date.now(), pid: p.id, bid: bid, change: o, reason: 'Opening stock' });
      }
    }
    closeModal(); draw(); toast(id ? 'Saved.' : 'Added. It is on the sell screen now.');
  }

  /* ---------- STOCK ---------- */
  function stBranch() {
    if (!S.stBranch || !branchOf(S.stBranch)) S.stBranch = S.role === 'manager' ? me().branch : S.branches[0].id;
    return S.stBranch;
  }
  function pageStock() {
    var bid = stBranch(), tracked = S.products.filter(function (p) { return p.active && p.track; });
    var low = tracked.filter(function (p) { return qty(p.id, bid) <= p.low; }).length;
    var val = tracked.reduce(function (a, p) { return a + Math.max(0, qty(p.id, bid)) * p.cost; }, 0);
    q$('#dm-page').innerHTML = '<div class="dm-row dm-between"><h2>Stock</h2>' + (S.branches.length > 1 ? '<select class="dm-input dm-w200" data-a="stb" aria-label="Branch">' + branchOptions(bid) + '</select>' : '') + '</div>' +
      '<div class="dm-kpis"><div class="dm-kpi"><div class="v">' + tracked.length + '</div><div class="l">Tracked items</div></div><div class="dm-kpi"><div class="v">' + low + '</div><div class="l">Low or out of stock</div></div><div class="dm-kpi"><div class="v">' + money(val) + '</div><div class="l">Stock value at cost</div></div></div>' +
      '<div class="dm-row" style="margin-bottom:10px"><input id="dm-stq" class="dm-input dm-grow" placeholder="Search" value="' + esc(S.stQ) + '" aria-label="Search"><label class="dm-row"><input type="checkbox" data-a="stlow"' + (S.stLow ? ' checked' : '') + '> Low stock only</label></div>' +
      '<div class="dm-card dm-tw" id="dm-sttbl"></div>' +
      '<div class="dm-card"><h3>Recent stock changes</h3><div class="dm-tw"><table class="dm-tbl"><thead><tr><th>When</th><th>Item</th><th class="n">Change</th><th>Reason</th></tr></thead><tbody>' +
      (S.moves.filter(function (m) { return m.bid === bid; }).slice(0, 12).map(function (m) {
        var p = prod(m.pid);
        return '<tr><td>' + fmtTime(m.ts) + '</td><td>' + esc(p ? p.name : '') + '</td><td class="n">' + (m.change > 0 ? '+' : '') + fmt(m.change) + '</td><td>' + esc(m.reason) + '</td></tr>';
      }).join('') || '<tr><td colspan="4" class="dm-muted">No changes yet.</td></tr>') + '</tbody></table></div></div>';
    stockTable();
  }
  function stockTable() {
    var bid = stBranch(), t = S.stQ.trim().toLowerCase();
    var rows = S.products.filter(function (p) { return p.active && p.track && (!t || p.name.toLowerCase().indexOf(t) >= 0 || (p.barcode || '').indexOf(t) >= 0) && (!S.stLow || qty(p.id, bid) <= p.low); });
    q$('#dm-sttbl').innerHTML = '<table class="dm-tbl"><thead><tr><th>Name</th><th class="n">In stock</th><th class="n">Warn at</th><th></th></tr></thead><tbody>' +
      (rows.map(function (p) {
        var q = qty(p.id, bid);
        return '<tr><td><b>' + esc(p.name) + '</b></td><td class="n">' + (q <= p.low ? '<span class="dm-badge red">' + fmt(q) + '</span>' : fmt(q)) + '</td><td class="n">' + fmt(p.low) + '</td><td class="dm-r"><button type="button" class="dm-btn sm" data-a="adj" data-id="' + p.id + '">Receive / adjust</button></td></tr>';
      }).join('') || '<tr><td colspan="4" class="dm-muted">No tracked items found.</td></tr>') + '</tbody></table>';
  }
  function adjustForm(p) {
    openModal(p.name, '<form data-form="adjust" data-id="' + p.id + '"><p class="dm-muted">Currently ' + fmt(qty(p.id, stBranch())) + ' in stock. Enter a positive number to add, a negative number to remove.</p>' +
      '<label class="dm-field"><span>Quantity change</span><input class="dm-input" name="change" inputmode="decimal" required></label>' +
      '<label class="dm-field"><span>Reason</span><select class="dm-input" name="reason">' + ['Received stock', 'Stock count correction', 'Damaged or expired', 'Returned to supplier', 'Other'].map(function (r) { return '<option>' + r + '</option>'; }).join('') + '</select></label>' +
      '<div class="dm-err" id="dm-ferr"></div><button class="dm-btn pri" style="width:100%">Save</button></form>');
  }

  /* ---------- REPORTS ---------- */
  var PRE = [['today', 'Today'], ['last7', 'Last 7 days'], ['thisweek', 'This week'], ['lastweek', 'Last week'], ['last30', 'Last 30 days']];
  function rangeFor(k) {
    var now = new Date(), d0 = startOfDay(now);
    if (k === 'today') return { from: d0, to: addDays(d0, 1) };
    if (k === 'last7') return { from: addDays(d0, -6), to: addDays(d0, 1) };
    if (k === 'lastweek') { var m = monday(now); return { from: addDays(m, -7), to: m }; }
    if (k === 'last30') return { from: addDays(d0, -29), to: addDays(d0, 1) };
    var mm = monday(now); return { from: mm, to: addDays(mm, 7) };
  }
  function repData(from, to, bid) {
    var ss = S.sales.filter(function (s) { return s.ts >= from && s.ts < to && (!bid || s.bid === bid); });
    var r = { n: ss.length, rev: 0, profit: 0, byDay: {}, byBranch: {}, byPay: {}, byProd: {}, byCash: {} };
    function add(o, k, rev, c, q) { var x = o[k] || (o[k] = { name: k, rev: 0, n: 0, qty: 0 }); x.rev += rev; x.n += c; x.qty += q; }
    ss.forEach(function (s) {
      r.rev += s.total;
      s.items.forEach(function (i) { r.profit += (i.price - i.cost) * i.qty; add(r.byProd, i.name, i.qty * i.price, 0, i.qty); });
      r.byDay[dayKey(s.ts)] = (r.byDay[dayKey(s.ts)] || 0) + s.total;
      var b = branchOf(s.bid); add(r.byBranch, b ? b.name : '?', s.total, 1, 0);
      add(r.byPay, s.method || 'Other', s.total, 1, 0); add(r.byCash, staffName(s.cashier), s.total, 1, 0);
    });
    return r;
  }
  function pageReports() {
    var rg = rangeFor(S.rep.preset), len = rg.to - rg.from, bid = S.rep.branch;
    var cur = repData(rg.from.getTime(), rg.to.getTime(), bid), prev = repData(rg.from.getTime() - len, rg.from.getTime(), bid);
    function delta(a, b) { return b ? (((a - b) / b) * 100 >= 0 ? '+' : '') + Math.round(((a - b) / b) * 100) + '% vs previous' : ''; }
    function list(title, o, withQty, max) {
      var rows = Object.keys(o).map(function (k) { return o[k]; }).sort(function (a, b) { return b.rev - a.rev; }).slice(0, max || 20);
      return '<div class="dm-card"><h3>' + title + '</h3><table class="dm-tbl"><tbody>' + (rows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td class="n">' + (withQty ? fmt(r.qty) + ' sold' : r.n + ' sales') + '</td><td class="n"><b>' + money(r.rev) + '</b></td></tr>';
      }).join('') || '<tr><td class="dm-muted">No data</td></tr>') + '</tbody></table></div>';
    }
    var days = [], d;
    for (d = new Date(rg.from); d < rg.to; d.setDate(d.getDate() + 1)) days.push({ k: dayKey(d), dt: new Date(d) });
    var mx = Math.max(1, Math.max.apply(null, days.map(function (x) { return cur.byDay[x.k] || 0; })));
    var bars = days.map(function (x, i) {
      var v = cur.byDay[x.k] || 0, many = days.length > 8;
      var lab = !many ? x.dt.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric' }) : (i % 5 === 0 ? String(x.dt.getDate()) : '');
      return '<div class="dm-bar"><div class="u">' + (v && !many ? fmt(v) : '') + '</div><div class="f" style="height:' + (v / mx * 100) + '%"></div><div class="t">' + lab + '</div></div>';
    }).join('');
    var lowRows = S.products.filter(function (p) { return p.active && p.track; }).map(function (p) {
      var t = 0; S.branches.forEach(function (b) { if (!bid || b.id === bid) t += qty(p.id, b.id); }); return { name: p.name, q: t, low: p.low };
    }).filter(function (x) { return x.q <= x.low; }).sort(function (a, b) { return a.q - b.q; }).slice(0, 10);
    q$('#dm-page').innerHTML = '<div class="dm-row dm-between"><h2>Reports</h2><div class="dm-row">' +
      '<select class="dm-input" style="width:170px" data-a="rp" aria-label="Period">' + PRE.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === S.rep.preset ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select>' +
      (S.branches.length > 1 ? '<select class="dm-input dm-w200" data-a="rb" aria-label="Branch">' + branchOptions(bid, true) + '</select>' : '') + '</div></div>' +
      '<p class="dm-muted dm-sm" style="margin:4px 0 0">' + esc(S.biz.name) + ' / ' + rg.from.toLocaleDateString('en-KE', { dateStyle: 'medium' }) + ' to ' + new Date(rg.to - 1).toLocaleDateString('en-KE', { dateStyle: 'medium' }) + '</p>' +
      '<div class="dm-kpis"><div class="dm-kpi"><div class="v">' + money(cur.rev) + '</div><div class="l">Revenue</div><div class="dm-sm dm-muted">' + delta(cur.rev, prev.rev) + '</div></div>' +
      '<div class="dm-kpi"><div class="v">' + cur.n + '</div><div class="l">Sales</div><div class="dm-sm dm-muted">' + delta(cur.n, prev.n) + '</div></div>' +
      '<div class="dm-kpi"><div class="v">' + money(cur.profit) + '</div><div class="l">Estimated profit</div><div class="dm-sm dm-muted">' + delta(cur.profit, prev.profit) + '</div></div>' +
      '<div class="dm-kpi"><div class="v">' + (cur.n ? money(cur.rev / cur.n) : '-') + '</div><div class="l">Average sale</div></div></div>' +
      '<div class="dm-card"><h3>Revenue per day</h3><div class="dm-bars">' + bars + '</div></div>' +
      '<div class="dm-cols">' + list('Best sellers', cur.byProd, true, 7) + list('By payment method', cur.byPay) + list('By branch', cur.byBranch) + list('By cashier', cur.byCash) + '</div>' +
      '<div class="dm-card"><h3>Running low</h3><table class="dm-tbl"><tbody>' + (lowRows.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="n"><span class="dm-badge red">' + fmt(x.q) + ' left</span></td></tr>'; }).join('') || '<tr><td class="dm-muted">Nothing is running low.</td></tr>') + '</tbody></table></div>';
  }

  /* ---------- BRANCHES ---------- */
  function pageBranches() {
    q$('#dm-page').innerHTML = '<div class="dm-row dm-between"><h2>Branches</h2><button type="button" class="dm-btn pri" data-a="badd">Add branch</button></div>' +
      '<div class="dm-card dm-tw" style="margin-top:10px"><table class="dm-tbl"><thead><tr><th>Name</th><th>Address</th><th>Phone</th><th></th></tr></thead><tbody>' +
      S.branches.map(function (b) { return '<tr><td><b>' + esc(b.name) + '</b></td><td>' + (esc(b.address) || '-') + '</td><td>' + (esc(b.phone) || '-') + '</td><td class="dm-r"><button type="button" class="dm-btn sm" data-a="bedit" data-id="' + b.id + '">Edit</button></td></tr>'; }).join('') +
      '</tbody></table></div><p class="dm-muted dm-sm">Each branch keeps its own stock. Assign cashiers to a branch in Staff.</p>';
  }
  function branchForm(b) {
    b = b || { name: '', address: '', phone: '' };
    openModal(b.id ? 'Edit branch' : 'Add branch', '<form data-form="branch" data-id="' + (b.id || '') + '">' +
      '<label class="dm-field"><span>Name</span><input class="dm-input" name="name" required value="' + esc(b.name) + '"></label>' +
      '<label class="dm-field"><span>Address (printed on receipts)</span><input class="dm-input" name="address" value="' + esc(b.address) + '"></label>' +
      '<label class="dm-field"><span>Phone</span><input class="dm-input" name="phone" value="' + esc(b.phone) + '"></label><button class="dm-btn pri" style="width:100%">Save</button></form>');
  }

  /* ---------- STAFF ---------- */
  function isPersona(id) { return id === S.persona.owner || id === S.persona.manager || id === S.persona.cashier; }
  function pageStaff() {
    q$('#dm-page').innerHTML = '<div class="dm-row dm-between"><h2>Staff</h2><button type="button" class="dm-btn pri" data-a="sadd">Add staff</button></div>' +
      '<div class="dm-card dm-tw" style="margin-top:10px"><table class="dm-tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th><th>Status</th><th></th></tr></thead><tbody>' +
      S.staff.map(function (u) {
        var fixedRole = u.role === 'owner' || isPersona(u.id), isOwner = u.role === 'owner';
        return '<tr><td><b>' + esc(u.name) + '</b></td><td>' + esc(u.email) + '</td><td>' +
          (fixedRole ? '<span class="dm-badge">' + u.role + '</span>' : '<select data-a="srole" data-id="' + u.id + '" aria-label="Role"><option value="cashier"' + (u.role === 'cashier' ? ' selected' : '') + '>cashier</option><option value="manager"' + (u.role === 'manager' ? ' selected' : '') + '>manager</option></select>') + '</td><td>' +
          (isOwner ? esc((branchOf(u.branch) || {}).name || '-') : '<select data-a="sbr" data-id="' + u.id + '" aria-label="Branch">' + branchOptions(u.branch) + '</select>') + '</td>' +
          '<td>' + (u.active ? '<span class="dm-badge">Active</span>' : '<span class="dm-badge red">Disabled</span>') + '</td><td class="dm-r" style="white-space:nowrap">' +
          (isOwner ? '' : '<button type="button" class="dm-btn sm" data-a="spw" data-id="' + u.id + '">Reset password</button> <button type="button" class="dm-btn sm' + (u.active ? ' dan' : '') + '" data-a="sact" data-id="' + u.id + '">' + (u.active ? 'Disable' : 'Enable') + '</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="dm-muted dm-sm">Cashiers only see the Sell and My sales screens for their own branch. Managers also see products, stock and reports.</p>';
  }
  function staffForm() {
    openModal('Add staff', '<form data-form="staff"><label class="dm-field"><span>Full name</span><input class="dm-input" name="name" required></label>' +
      '<label class="dm-field"><span>Email (their login)</span><input class="dm-input" name="email" type="email" required></label>' +
      '<label class="dm-field"><span>Password (give it to them)</span><input class="dm-input" name="pw" required minlength="6"></label>' +
      '<div class="dm-row"><label class="dm-field dm-grow"><span>Role</span><select class="dm-input" name="role"><option value="cashier">Cashier</option><option value="manager">Manager</option></select></label>' +
      '<label class="dm-field dm-grow"><span>Branch</span><select class="dm-input" name="branch">' + branchOptions(S.branches[0].id) + '</select></label></div><button class="dm-btn pri" style="width:100%">Create account</button></form>');
  }

  /* ---------- SETTINGS ---------- */
  function pageSettings() {
    if (!S.draft) S.draft = { name: S.biz.name, preset: S.type, item: S.biz.item, currency: S.biz.currency, tax: S.biz.tax, pay: S.biz.pay.join(', '), header: S.biz.header, footer: S.biz.footer, fields: S.biz.fields.map(function (f) { return Object.assign({}, f); }) };
    var d = S.draft;
    q$('#dm-page').innerHTML = '<div style="max-width:700px"><h2>Settings</h2><p class="dm-muted">Make Uzaa fit your business. Changes apply to every screen and receipt in this demo.</p>' +
      '<div class="dm-card"><h3>Business</h3>' +
      '<label class="dm-field"><span>Business name</span><input class="dm-input" data-k="name" value="' + esc(d.name) + '"></label>' +
      '<label class="dm-field"><span>Start from a business type (replaces the labels and fields below)</span><select class="dm-input" data-a="spreset">' + Object.keys(PRESETS).map(function (k) { return '<option value="' + k + '"' + (k === d.preset ? ' selected' : '') + '>' + PRESETS[k].label + '</option>'; }).join('') + '</select></label>' +
      '<label class="dm-field"><span>What do you sell? (shown as the item name)</span><input class="dm-input" data-k="item" value="' + esc(d.item) + '"></label>' +
      '<div class="dm-row"><label class="dm-field dm-grow"><span>Currency</span><input class="dm-input" data-k="currency" value="' + esc(d.currency) + '"></label><label class="dm-field dm-grow"><span>Tax rate (%)</span><input class="dm-input" data-k="tax" inputmode="decimal" value="' + esc(d.tax) + '"></label></div>' +
      '<label class="dm-field"><span>Payment methods (separate with commas)</span><input class="dm-input" data-k="pay" value="' + esc(d.pay) + '"></label></div>' +
      '<div class="dm-card"><h3>Extra product fields</h3><p class="dm-muted dm-sm">For example Expiry date for a pharmacy, Size for clothes, Unit for hardware.</p>' +
      d.fields.map(function (f, i) {
        return '<div class="dm-row" style="margin-bottom:8px"><input class="dm-input dm-grow" placeholder="Field name" data-fi="' + i + '" data-fk="label" value="' + esc(f.label) + '" aria-label="Field name">' +
          '<select class="dm-input" style="width:120px" data-fi="' + i + '" data-fk="type" aria-label="Field type">' + ['text', 'number', 'date'].map(function (t) { return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>'; }).join('') + '</select>' +
          '<button type="button" class="dm-btn sm dan" data-a="frem" data-i="' + i + '">Remove</button></div>';
      }).join('') + '<button type="button" class="dm-btn sm" data-a="fadd">Add a field</button></div>' +
      '<div class="dm-card"><h3>Receipt</h3><label class="dm-field"><span>Header (address, PIN, phone)</span><textarea class="dm-input" data-k="header">' + esc(d.header) + '</textarea></label>' +
      '<label class="dm-field"><span>Footer message</span><textarea class="dm-input" data-k="footer">' + esc(d.footer) + '</textarea></label></div>' +
      '<div class="dm-err" id="dm-serr"></div><button type="button" class="dm-btn pri" data-a="ssave">Save settings</button></div>';
  }
  function saveSettings() {
    var d = S.draft, pay = d.pay.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!pay.length) { q$('#dm-serr').textContent = 'Add at least one payment method'; return; }
    S.biz.name = d.name.trim() || S.biz.name; S.biz.item = d.item.trim() || 'Product'; S.biz.currency = d.currency.trim() || 'KES';
    S.biz.tax = Number(d.tax) || 0; S.biz.pay = pay; S.biz.header = d.header; S.biz.footer = d.footer;
    S.biz.fields = d.fields.filter(function (f) { return f.label.trim(); }).map(function (f) {
      return { key: f.key || f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label: f.label.trim(), type: f.type };
    });
    S.draft = null; draw(); toast('Saved. Every screen and receipt now uses these settings.');
  }

  /* ---------- events ---------- */
  root.addEventListener('click', function (e) {
    if (e.target.classList && e.target.classList.contains('dm-overlay')) return closeModal();
    var t = e.target.closest('[data-a]'); if (!t || t.tagName === 'SELECT' || t.tagName === 'INPUT') return;
    var a = t.dataset.a, id = t.dataset.id, v = t.dataset.v, p, l;
    switch (a) {
      case 'type': typeNow = v; build(v); syncControls(); draw(); break;
      case 'role': roleNow = v; S.role = v; S.draft = null; syncControls(); draw(); break;
      case 'reset': build(typeNow); syncControls(); draw(); toast('Demo reset.'); break;
      case 'tab': S.tab = v; S.draft = null; draw(); break;
      case 'add': addToCart(id); var qi = q$('#dm-q'); if (qi) qi.focus(); break;
      case 'scan': scan(); break;
      case 'qm': case 'qp':
        l = S.sell.cart.filter(function (x) { return x.id === id; })[0];
        if (l) { l.qty += a === 'qp' ? 1 : -1; if (l.qty <= 0) S.sell.cart.splice(S.sell.cart.indexOf(l), 1); renderCart(); } break;
      case 'pm': S.sell.method = v; S.sell.paid = ''; renderCart(); break;
      case 'clear': S.sell.cart = []; S.sell.discount = ''; S.sell.paid = ''; renderCart(); break;
      case 'charge': charge(); break;
      case 'print': toast('Sent to the receipt printer. On a real till this prints.'); break;
      case 'mclose': closeModal(); var q2 = q$('#dm-q'); if (q2) q2.focus(); break;
      case 'vsale':
        var s = S.sales.filter(function (x) { return x.id === id; })[0];
        if (s) openModal('', receiptHTML(s) + '<div class="dm-row" style="margin-top:16px"><button type="button" class="dm-btn" data-a="print">Print receipt</button><button type="button" class="dm-btn pri dm-grow" data-a="mclose">Close</button></div>'); break;
      case 'padd': productForm(null); break;
      case 'pedit': productForm(prod(id)); break;
      case 'phide': p = prod(id); p.active = !p.active; productsTable(); break;
      case 'adj': adjustForm(prod(id)); break;
      case 'badd': branchForm(null); break;
      case 'bedit': branchForm(branchOf(id)); break;
      case 'sadd': staffForm(); break;
      case 'spw': toast('Password reset. In the real app you set the new password here.'); break;
      case 'sact':
        p = S.staff.filter(function (x) { return x.id === id; })[0]; p.active = !p.active; pageStaff();
        if (!p.active && isPersona(p.id)) toast('Disabled. Switch "View as" to ' + p.role + ' to see what that person sees.'); break;
      case 'fadd': S.draft.fields.push({ key: '', label: '', type: 'text' }); pageSettings(); break;
      case 'frem': S.draft.fields.splice(Number(t.dataset.i), 1); pageSettings(); break;
      case 'ssave': saveSettings(); break;
    }
  });
  root.addEventListener('change', function (e) {
    var t = e.target, a = t.dataset.a, v = t.value, p;
    if (a === 'qty') {
      var l = S.sell.cart.filter(function (x) { return x.id === t.dataset.id; })[0];
      if (l) { l.qty = Math.max(0, Number(v) || 0); if (!l.qty) S.sell.cart.splice(S.sell.cart.indexOf(l), 1); renderCart(); }
    } else if (a === 'sbranch') { S.sell.branch = v; S.sell.cart = []; renderTiles(); renderCart(); }
    else if (a === 'sday') { if (v) { S.salesDay = v; salesBody(); } }
    else if (a === 'sbr2') { S.salesBranch = v; salesBody(); }
    else if (a === 'stb') { S.stBranch = v; pageStock(); }
    else if (a === 'stlow') { S.stLow = t.checked; stockTable(); }
    else if (a === 'rp') { S.rep.preset = v; pageReports(); }
    else if (a === 'rb') { S.rep.branch = v; pageReports(); }
    else if (a === 'srole') { p = S.staff.filter(function (x) { return x.id === t.dataset.id; })[0]; p.role = v; toast('Role changed.'); }
    else if (a === 'sbr') { p = S.staff.filter(function (x) { return x.id === t.dataset.id; })[0]; p.branch = v; toast('Moved to ' + branchOf(v).name + '.'); }
    else if (a === 'spreset') { var pr = PRESETS[v]; S.draft.preset = v; S.draft.item = pr.item; S.draft.fields = pr.fields.map(function (f) { return Object.assign({}, f); }); pageSettings(); }
  });
  root.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'dm-q') { S.sell.q = t.value; msg(''); renderTiles(); }
    else if (t.id === 'dm-disc') { S.sell.discount = t.value; updateTotals(); }
    else if (t.id === 'dm-paid') { S.sell.paid = t.value; updateTotals(); }
    else if (t.id === 'dm-pq') { S.pQ = t.value; productsTable(); }
    else if (t.id === 'dm-stq') { S.stQ = t.value; stockTable(); }
    else if (t.dataset.k && S.draft) S.draft[t.dataset.k] = t.value;
    else if (t.dataset.fi !== undefined && S.draft) S.draft.fields[Number(t.dataset.fi)][t.dataset.fk] = t.value;
  });
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && q$('#dm-modal .dm-overlay')) return closeModal();
    if (e.key !== 'Enter' || e.target.id !== 'dm-q') return;
    e.preventDefault();
    var t = S.sell.q.trim(); if (!t) return;
    var exact = S.products.filter(function (p) { return p.active && p.barcode && p.barcode === t; })[0], f = filtered();
    if (exact) { addToCart(exact.id); S.sell.q = ''; e.target.value = ''; renderTiles(); msg('Scanned ' + t + ': ' + exact.name, true); }
    else if (f.length === 1) { addToCart(f[0].id); S.sell.q = ''; e.target.value = ''; renderTiles(); }
    else msg('No exact match for "' + t + '"');
  });
  root.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, kind = f.dataset.form, fd = new FormData(f), id = f.dataset.id, p;
    if (kind === 'product') return saveProduct(f);
    if (kind === 'adjust') {
      var ch = Number(fd.get('change')), pr = prod(id);
      if (!ch) { q$('#dm-ferr').textContent = 'Enter a quantity (use a minus sign to reduce)'; return; }
      setQty(id, stBranch(), qty(id, stBranch()) + ch);
      S.moves.unshift({ ts: Date.now(), pid: id, bid: stBranch(), change: ch, reason: fd.get('reason') });
      closeModal(); pageStock(); toast(pr.name + ' updated.');
    } else if (kind === 'branch') {
      p = id ? branchOf(id) : { id: nid('b') };
      p.name = (fd.get('name') || '').trim(); p.address = fd.get('address') || ''; p.phone = fd.get('phone') || '';
      if (!id) S.branches.push(p);
      closeModal(); draw(); toast('Branch saved.');
    } else if (kind === 'staff') {
      S.staff.push({ id: nid('u'), name: (fd.get('name') || '').trim(), email: (fd.get('email') || '').trim(), role: fd.get('role'), branch: fd.get('branch'), active: true });
      closeModal(); pageStaff(); toast('Account created. They can sign in with that email.');
    }
  });

  /* ---------- start ---------- */
  build(typeNow);
  shell(); syncControls(); draw();
})();
