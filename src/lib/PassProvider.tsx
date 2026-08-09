import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabaseClient";
import { useSession } from "./useSession";
import { PassContext, type PassState } from "./passContext";

function buildNoneState(isLoadingPass: boolean): PassState {
  return {
    hasActivePass: false,
    passStatus: "none",
    passEndsAt: null,
    isLoadingPass,
    refreshPass: async () => {},
  };
}

export function PassProvider({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const [state, setState] = useState<PassState>(() => buildNoneState(true));

  const loadPass = useCallback(async () => {
    if (!session?.user) {
      setState(buildNoneState(false));
      return;
    }

    setState((prev) => ({ ...prev, isLoadingPass: true }));

    const { data, error } = await supabase
      .from("current_user_pass")
      .select("ends_at")
      .maybeSingle();

    if (error || !data) {
      setState(buildNoneState(false));
      return;
    }

    setState({
      hasActivePass: true,
      passStatus: "active",
      passEndsAt: (data as { ends_at?: string | null })?.ends_at ?? null,
      isLoadingPass: false,
      refreshPass: async () => {},
    });
  }, [session?.user]);

  useEffect(() => {
    if (loading) {
      setState((prev) => ({ ...prev, isLoadingPass: true }));
      return;
    }

    if (!session?.user) {
      setState(buildNoneState(false));
      return;
    }

    loadPass();
  }, [loading, session?.user, loadPass]);

  const refreshPass = useCallback(async () => {
    await loadPass();
  }, [loadPass]);

  const value = useMemo(
    () => ({
      ...state,
      refreshPass,
    }),
    [state, refreshPass]
  );

  return <PassContext.Provider value={value}>{children}</PassContext.Provider>;
}
