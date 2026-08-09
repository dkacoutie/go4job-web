import { createContext } from "react";

export type PassStatus = "active" | "none";

export type PassState = {
  hasActivePass: boolean;
  passStatus: PassStatus;
  passEndsAt: string | null;
  isLoadingPass: boolean;
  refreshPass: () => Promise<void>;
};

export const PassContext = createContext<PassState | null>(null);
