// Shim for `next/navigation` backed by react-router.
import { useMemo } from "react";
import { useNavigate, useLocation, useSearchParams as useRRSearchParams, useParams as useRRParams } from "react-router-dom";

export function useRouter() {
  const navigate = useNavigate();
  // Next's useRouter() returns a STABLE reference; lots of ported effects put
  // `router` in their dependency arrays. Returning a fresh object each render
  // would refire those effects every render (infinite refetch loops), so memo.
  return useMemo(
    () => ({
      push: (href: string) => navigate(href),
      replace: (href: string) => navigate(href, { replace: true }),
      back: () => navigate(-1),
      forward: () => navigate(1),
      refresh: () => { /* no-op: SPA data is refetched explicitly */ },
      prefetch: () => { /* no-op */ },
    }),
    [navigate],
  );
}

export function usePathname(): string {
  return useLocation().pathname;
}

// Next returns a ReadonlyURLSearchParams; URLSearchParams is read-compatible (.get/.getAll/.has).
export function useSearchParams(): URLSearchParams {
  const [params] = useRRSearchParams();
  return params;
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useRRParams() as T;
}
