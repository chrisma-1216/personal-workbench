import { supabase } from './supabase.js';
import { VAPID_PUBLIC_KEY } from './config.js';
import { upsertSubscription, listSubscriptions, deactivateSubscription } from './api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function abToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 注册 SW + 请求权限 + 订阅 + 写库。deviceLabel 用于区分设备。
// 全程用 try/catch 包住，任何一步失败都返回 { error }，不让异常被静默吞掉。
// 写库后回读云端确认，保证界面状态 = 真实云端状态。
export async function registerAndSubscribe(deviceLabel = '我的设备') {
  try {
    if (!('serviceWorker' in navigator)) {
      return { error: new Error('当前环境不支持 Service Worker（请用 iPhone 主屏打开的 PWA）') };
    }
    if (!('PushManager' in window)) {
      return { error: new Error('当前环境不支持 Web Push（需 iOS 16.4+，且从主屏图标打开）') };
    }

    // 1) 必须先登录，否则订阅无法归属到你的账号
    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) {
      return { error: new Error('未登录：请先在「设置」登录账号，再开启推送') };
    }

    // 2) 请求通知权限
    let perm = 'default';
    try {
      perm = await Notification.requestPermission();
    } catch (e) {
      return { error: new Error('请求通知权限失败：' + e.message) };
    }
    if (perm !== 'granted') {
      return { error: new Error('未授权通知（当前状态：' + perm + '）。请在 iPhone 系统设置→通知里允许本 App，再重试') };
    }

    // 3) 注册 Service Worker
    let reg;
    try {
      reg = await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
    } catch (e) {
      return { error: new Error('Service Worker 注册失败：' + e.message) };
    }

    // 4) 订阅（已存在则复用）
    let sub;
    try {
      sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
    } catch (e) {
      return { error: new Error('Push 订阅失败：' + e.message) };
    }

    // 5) 写库（upsert by endpoint）
    const { error } = await upsertSubscription({
      owner_id: user.id,
      endpoint: sub.endpoint,
      keys: {
        p256dh: abToBase64Url(sub.getKey('p256dh')),
        auth: abToBase64Url(sub.getKey('auth')),
      },
      device_label: deviceLabel,
      origin: window.location.origin,
      is_active: true,
    });
    if (error) {
      return { error: new Error('写入订阅失败：' + (error.message || JSON.stringify(error))) };
    }

    // 6) 回读云端确认
    const { data: list } = await listSubscriptions();
    const confirmed = Array.isArray(list) && list.some((s) => s.endpoint === sub.endpoint);
    if (!confirmed) {
      return { error: new Error('订阅已生成，但云端未确认（可能 RLS/网络）。请稍后重试') };
    }

    return { subscription: sub };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function unsubscribe() {
  const sub = await currentSubscription();
  if (!sub) return;
  const { data } = await listSubscriptions();
  const match = data?.find((s) => s.endpoint === sub.endpoint);
  if (match) await deactivateSubscription(match.id);
  await sub.unsubscribe();
}
