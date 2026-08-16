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
export async function registerAndSubscribe(deviceLabel = '我的设备') {
  if (!('serviceWorker' in navigator)) return { error: new Error('浏览器不支持 Service Worker') };
  if (!('PushManager' in window)) return { error: new Error('浏览器不支持 Web Push') };

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { error: new Error('未授权通知权限'), permission: perm };

  const reg = await navigator.serviceWorker.register('./sw.js');
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const { data: user } = await supabase.auth.getUser();
  const { error } = await upsertSubscription({
    owner_id: user.data.user.id,
    endpoint: sub.endpoint,
    keys: {
      p256dh: abToBase64Url(sub.getKey('p256dh')),
      auth: abToBase64Url(sub.getKey('auth')),
    },
    device_label: deviceLabel,
    origin: window.location.origin,
    is_active: true,
  });
  if (error) return { error };
  return { subscription: sub };
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
