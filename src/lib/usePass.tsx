import { useContext } from "react";
import { PassContext } from "./passContext";

export function usePass() {
  const ctx = useContext(PassContext);
  if (!ctx) {
    throw new Error("usePass must be used within PassProvider");
  }
  return ctx;
}
