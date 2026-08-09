import { createContext } from "react";

export type ToastKind = "success" | "error" | "info";

export type ToastInput = {
  kind?: ToastKind;
  title: string;
  message?: string;
  durationMs?: number;
};

export type ToastItem = ToastInput & {
  id: string;
  kind: ToastKind;
};

export type ToastContextValue = {
  pushToast: (toast: ToastInput) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);
