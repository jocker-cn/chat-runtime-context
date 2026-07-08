import type { ReactNode } from "react";

export interface InnerFocusManagerProps {
  enabled?: boolean;
  role?: string;
  children: ReactNode;
}

export function InnerFocusManager({
  role,
  children,
}: InnerFocusManagerProps) {
  return role ? <div role={role}>{children}</div> : <>{children}</>;
}
