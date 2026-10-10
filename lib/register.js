import { TYPE_PRESETS } from './util';

/** Creates the business for a freshly confirmed owner, using the details they gave at signup. Safe to call twice. */
export async function registerFromMeta(sb, user) {
  const m = user?.user_metadata || {};
  const name = String(m.business || '').trim().slice(0, 120);
  const full = String(m.full_name || '').trim().slice(0, 120);
  const type = TYPE_PRESETS[m.type] ? m.type : 'retail';
  if (!name || !full) return false;
  const { data: existing } = await sb.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (existing) return true;
  const p = TYPE_PRESETS[type];
  const { error } = await sb.rpc('register_business', {
    p_name: name, p_type: type, p_full_name: full, p_item_label: p.item_label, p_custom_fields: p.custom_fields,
  });
  return !error;
}
