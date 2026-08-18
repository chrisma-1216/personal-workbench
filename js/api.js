import { supabase } from './supabase.js';

async function myId() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// ============================ 时间块 ============================
export async function listTimeBlocks(dayKey) {
  return supabase
    .from('time_block')
    .select('*')
    .eq('day_key', dayKey)
    .is('deleted_at', null)
    .order('start_at');
}

// 录入严格三项：起止时间 + 标题。module_key 由服务端/词表推断，不占录入步骤。
export async function createTimeBlock({ start_at, end_at, title, module_key = null, remind_enabled = false, remind_at = null, remind_text = null }) {
  return supabase.from('time_block').insert({
    start_at, end_at, title, module_key, remind_enabled, remind_at, remind_text,
  }).select().single();
}

export async function updateTimeBlock(id, patch) {
  return supabase.from('time_block').update(patch).eq('id', id).select().single();
}

// ============================ 记账 ============================
export async function listTxns(dayKey) {
  return supabase.from('txn').select('*').eq('day_key', dayKey).is('deleted_at', null).order('occurred_at', { ascending: false });
}

// 只做流水：amount / direction / category_key。occurred_at 服务端默认 now()。
export async function createTxn({ amount, direction, category_key, note = '' }) {
  return supabase.from('txn').insert({ amount, direction, category_key, note }).select().single();
}
export async function deleteTxn(id) {
  return supabase.from('txn').update({ deleted_at: new Date().toISOString() }).eq('id', id);
}

// ============================ 体重 ============================
export async function createWeight(value, note = '') {
  return supabase.from('weight_log').insert({ value, note }).select().single();
}
export async function listWeights(limit = 30) {
  return supabase.from('weight_log').select('*').is('deleted_at', null).order('occurred_at', { ascending: false }).limit(limit);
}
// 按业务日查询（明细抽屉用），倒序
export async function listWeightsByDay(dayKey) {
  return supabase.from('weight_log').select('*').eq('day_key', dayKey).is('deleted_at', null).order('occurred_at', { ascending: false });
}
export async function deleteWeight(id) {
  return supabase.from('weight_log').update({ deleted_at: new Date().toISOString() }).eq('id', id);
}

// ============================ 锻炼 ============================
export async function createExercise({ type = '其他', duration_min, intensity, note = '' }) {
  return supabase.from('exercise_log').insert({ type, duration_min, intensity, note }).select().single();
}
export async function listExercises(dayKey) {
  return supabase.from('exercise_log').select('*').eq('day_key', dayKey).is('deleted_at', null).order('occurred_at', { ascending: false });
}
export async function deleteExercise(id) {
  return supabase.from('exercise_log').update({ deleted_at: new Date().toISOString() }).eq('id', id);
}

// ============================ 饮食 ============================
// slot: breakfast/lunch/dinner/snack；fullness 1–10（目标 8，超 8 = 负向）
export async function createMeal({ slot, fullness, note = '' }) {
  return supabase.from('meal_log').insert({ slot, fullness, note }).select().single();
}
export async function listMeals(dayKey) {
  return supabase.from('meal_log').select('*').eq('day_key', dayKey).is('deleted_at', null).order('occurred_at', { ascending: false });
}
export async function deleteMeal(id) {
  return supabase.from('meal_log').update({ deleted_at: new Date().toISOString() }).eq('id', id);
}

// ============================ 当日总结（21:00 推送同源） ============================
export async function getDailySummary() {
  const id = await myId();
  return supabase.rpc('build_daily_summary', { p_owner: id });
}

// ============================ 推送订阅 ============================
export async function upsertSubscription(rec) {
  return supabase.from('push_subscription').upsert(rec, { onConflict: 'endpoint' }).select().single();
}
export async function listSubscriptions() {
  return supabase.from('push_subscription').select('*').eq('is_active', true);
}
export async function deactivateSubscription(id) {
  return supabase.from('push_subscription').update({ is_active: false }).eq('id', id);
}

// ============================ 提醒开关 ============================
export async function getReminders() {
  return supabase.from('reminder').select('*').order('kind');
}
export async function setReminderEnabled(kind, enabled) {
  const id = await myId();
  return supabase.from('reminder').upsert(
    { owner_id: id, kind, enabled },
    { onConflict: 'owner_id,kind' }
  ).select().single();
}
