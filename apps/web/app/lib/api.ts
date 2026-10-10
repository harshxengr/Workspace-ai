const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type ApiFetchOptions = RequestInit & {
  headers?: HeadersInit;
};

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error ??
        data?.message ??
        `Request failed with status ${response.status}`,
    );
  }

  return data as T;
}