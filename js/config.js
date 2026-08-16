// 个人工作台 PWA · 配置
// 只需改这一处：把 ANON_KEY 换成你的真实 anon key。
// 位置：Supabase Dashboard → Settings → API → Project API keys → anon public
// ⚠️ 绝不要在这里放 service_role key（会泄露全库权限）。前端只能放 anon key，权限由 RLS 守。
// 账号：单用户，无需配 SMTP。最省事——去 Supabase Dashboard → Authentication → Add user 手动建一个
//   邮箱+密码账号（该账号已确认），PWA 直接用「登录」即可。或在 PWA 里用「注册」也行（若开了邮件确认需先点确认信）。
export const SUPABASE_URL = 'https://psvzecrmucyqeywtycws.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Z7nth-axwkjBtnclo36Hrw_u1Ll-Z7M';

// VAPID 公钥（公开信息，与手机订阅同一对，沿用即可，勿轮换）
export const VAPID_PUBLIC_KEY = 'BIpY-A0buwvvks3W-PgAksaEhWU3cgIReRI93hhz5bdLCWaDi5lMglcGap6_sMf4gBQtJbQyva61TUVIJ97vfDs';
