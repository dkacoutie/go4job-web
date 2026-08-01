import { supabase } from "./supabaseClient";

export const JOBRADAR_NOTIFICATIONS_CHANGED_EVENT = "jobradar:notifications-changed";

export type JobRadarNotificationKind =
  | "new_matches"
  | "alert_active"
  | "saved_job_expiring"
  | "subscription_status";

export type JobRadarNotification = {
  id: string;
  user_id: string;
  kind: JobRadarNotificationKind;
  title: string;
  body: string;
  cta_label: string | null;
  cta_path: string | null;
  related_id: string | null;
  dedupe_key: string;
  read_at: string | null;
  created_at: string;
};

type NotificationQueryResult<T> = {
  data: T;
  unavailable: boolean;
  error: string | null;
};

const TABLE_MISSING_CODES = new Set(["42P01", "PGRST106", "PGRST205"]);

function isNotificationsTableMissing(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (error.code && TABLE_MISSING_CODES.has(error.code)) return true;

  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("user_notifications") &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find"))
  );
}

export function isSafeNotificationPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("://") || path.includes("..")) return false;
  return true;
}

export function formatNotificationBadge(count: number) {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}

export function emitNotificationsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(JOBRADAR_NOTIFICATIONS_CHANGED_EVENT));
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export async function syncInstalledAppBadge(count: number) {
  if (typeof navigator === "undefined") return;

  const badgeNavigator = navigator as BadgeNavigator;
  try {
    if (count > 0 && badgeNavigator.setAppBadge) {
      await badgeNavigator.setAppBadge(count);
    } else if (badgeNavigator.clearAppBadge) {
      await badgeNavigator.clearAppBadge();
    }
  } catch {
    // Badge support depends on browser, OS and install mode.
  }
}

export async function fetchUnreadNotificationCount(userId: string): Promise<NotificationQueryResult<number>> {
  const { count, error } = await supabase
    .from("user_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) {
    if (isNotificationsTableMissing(error)) {
      return { data: 0, unavailable: true, error: null };
    }
    return { data: 0, unavailable: false, error: error.message };
  }

  return { data: count ?? 0, unavailable: false, error: null };
}

export async function fetchUserNotifications(
  userId: string,
  limit = 50,
): Promise<NotificationQueryResult<JobRadarNotification[]>> {
  const { data, error } = await supabase
    .from("user_notifications")
    .select(
      "id,user_id,kind,title,body,cta_label,cta_path,related_id,dedupe_key,read_at,created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isNotificationsTableMissing(error)) {
      return { data: [], unavailable: true, error: null };
    }
    return { data: [], unavailable: false, error: error.message };
  }

  return {
    data: (data ?? []) as JobRadarNotification[],
    unavailable: false,
    error: null,
  };
}

export async function markAllNotificationsRead(userId: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("user_notifications")
    .update({ read_at: now })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error && !isNotificationsTableMissing(error)) {
    return { ok: false, error: error.message, readAt: now };
  }

  emitNotificationsChanged();
  return { ok: true, error: null, readAt: now };
}
