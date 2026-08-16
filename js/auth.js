import { supabase } from './supabase.js';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// 单用户场景：邮箱 + 密码登录，零外部依赖（不依赖 SMTP）。
// 注册：首次用「注册」按钮，Supabase 默认会发确认邮件；
//   想完全免邮件，可在 Dashboard → Authentication → Add user 手动建账号（已确认），
//   或关掉 Settings → Auth → User Signups → Confirm email。
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error };
}

export async function signUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  return { error };
}

export async function logout() {
  await supabase.auth.signOut();
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_event, session) => cb(session));
}
