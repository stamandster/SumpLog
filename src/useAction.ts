import { useRef, useState } from "react";

export function useAction() {
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState(new Set<string>());
  const [error, setError] = useState("");
  const run = async (key: string, operation: () => Promise<unknown>) => {
    if (inFlight.current.has(key)) return false;
    inFlight.current.add(key); setPending(new Set(inFlight.current)); setError("");
    try { await operation(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The action failed. Please try again."); return false; }
    finally { inFlight.current.delete(key); setPending(new Set(inFlight.current)); }
  };
  return { run, pending, error, clearError: () => setError("") };
}
