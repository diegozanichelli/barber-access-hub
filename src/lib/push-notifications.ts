import { supabase } from "@/integrations/supabase/client";

/**
 * Push só funciona com a chave pública VAPID publicada no bundle. Sem ela o
 * recurso fica desligado em vez de quebrar — a tela continua avisando pelo
 * banner, que não depende de nada disso.
 */
const VAPID_PUBLIC_KEY = import.meta.env["VITE_VAPID_PUBLIC_KEY"] as string | undefined;

export type PushSupport =
  { supported: true; permission: NotificationPermission } | { supported: false; reason: string };

export function inspectPushSupport(): PushSupport {
  if (typeof window === "undefined") return { supported: false, reason: "Sem navegador." };
  if (!("serviceWorker" in navigator)) {
    return { supported: false, reason: "Este navegador não suporta notificações." };
  }
  if (!("PushManager" in window) || !("Notification" in window)) {
    return { supported: false, reason: "Este navegador não suporta notificações." };
  }
  if (!VAPID_PUBLIC_KEY) {
    return { supported: false, reason: "Notificações não configuradas neste ambiente." };
  }
  // No iPhone o push só existe com o app adicionado à tela de início.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as unknown as { standalone?: boolean }).standalone);
  if (isIOS && !isStandalone) {
    return {
      supported: false,
      reason:
        "No iPhone, toque em Compartilhar e em 'Adicionar à Tela de Início' para receber avisos.",
    };
  }
  return { supported: true, permission: Notification.permission };
}

/** A chave VAPID viaja em base64url e o PushManager exige bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function encodeKey(subscription: PushSubscription, name: "p256dh" | "auth"): string {
  const key = subscription.getKey(name);
  if (!key) throw new Error("O navegador não forneceu as chaves da inscrição.");
  return window.btoa(String.fromCharCode(...new Uint8Array(key)));
}

/**
 * Registra o service worker, pede permissão e guarda a inscrição.
 * Idempotente: reaproveita a inscrição existente do navegador.
 */
export async function enablePushNotifications(userId: string): Promise<void> {
  const support = inspectPushSupport();
  if (!support.supported) throw new Error(support.reason);

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      "Permissão negada. Autorize as notificações nas configurações do navegador para este site.",
    );
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
    }));

  // upsert por endpoint: reinscrever no mesmo aparelho não duplica linha.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: encodeKey(subscription, "p256dh"),
      auth: encodeKey(subscription, "auth"),
      user_agent: navigator.userAgent.slice(0, 300),
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

export async function disablePushNotifications(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe();
}
