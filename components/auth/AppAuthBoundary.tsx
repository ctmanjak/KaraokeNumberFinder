"use client";

import type { ReactNode } from "react";
import { AuthHeader } from "./AuthHeader";
import { AuthProvider } from "./AuthProvider";

export function AppAuthBoundary({
  children
}: Readonly<{ children: ReactNode }>) {
  return (
    <AuthProvider>
      <AuthHeader />
      {children}
    </AuthProvider>
  );
}
