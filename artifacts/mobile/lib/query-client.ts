import { fetch } from "expo/fetch";
import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Gets the base URL for the Express API server (e.g., "http://localhost:3000")
 * @returns {string} The API base URL
 */
export function getApiUrl(): string {
  // 1. Explicit env override (used in dev when the Expo bundle needs to
  //    target the Replit dev domain even though it runs on localhost).
  const host = process.env.EXPO_PUBLIC_DOMAIN;
  if (host) {
    return new URL(`https://${host}`).href;
  }

  // 2. Web runtime fallback — same-origin against whatever domain served
  //    the page (production deploy, custom domain, preview, etc.). This
  //    is the path used by the production web build, where the Expo
  //    static export deliberately ships without a baked-in domain so the
  //    same bundle can be served from any URL.
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL("/", window.location.origin).href;
  }

  // 3. Native runtime with no domain configured — fail loudly so the
  //    caller knows EXPO_PUBLIC_DOMAIN must be provided for native builds.
  throw new Error("EXPO_PUBLIC_DOMAIN is not set");
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Read session token from localStorage for web requests
function getStoredToken(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem('alghazaly-app-storage-v3');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed?.state?.sessionToken || null;
  } catch {
    return null;
  }
}

function buildAuthHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const token = getStoredToken();
  return {
    ...(extraHeaders || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await fetch(url.toString(), {
    method,
    headers: buildAuthHeaders(data ? { "Content-Type": "application/json" } : {}),
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const res = await fetch(url.toString(), {
      credentials: "include",
      headers: buildAuthHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
