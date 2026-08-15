import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "../client";
import { queryClient } from "../queryClient";
import type { AuthResponse, User } from "../types";

export function useLogin() {
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      apiPost<AuthResponse>("/auth/login", body, {
        authenticated: false,
        allowRefresh: false,
        credentials: "include",
      }),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (body: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
    }) => apiPost<AuthResponse>("/auth/register", body, {
      authenticated: false,
      allowRefresh: false,
      credentials: "include",
    }),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (body: { email: string }) =>
      apiPost<{ success: true; message: string }>("/auth/forgot-password", body, {
        authenticated: false,
        allowRefresh: false,
      }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (body: { token: string; password: string }) =>
      apiPost<{ success: true; message: string }>("/auth/reset-password", body, {
        authenticated: false,
        allowRefresh: false,
      }),
  });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<User>("/users/me"),
  });
}

export function prefetchMe() {
  return queryClient.prefetchQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<User>("/users/me"),
  });
}
