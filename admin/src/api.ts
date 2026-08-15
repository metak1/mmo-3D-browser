const API_URL = import.meta.env.VITE_SERVER_HTTP_URL ?? "http://localhost:2567";
const TOKEN_STORAGE_KEY = "mmo:adminToken";

export class ApiError extends Error {}

export interface PublicUser {
  id: number;
  username: string;
  email: string;
  role: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error ?? `Request failed with status ${res.status}`);
  return body as T;
}

export function login(username: string, password: string): Promise<{ token: string; user: PublicUser }> {
  return request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function me(): Promise<{ user: PublicUser }> {
  return request("/auth/me");
}

// Every list/get call reads live from the DB via the server's Prisma queries - the admin panel
// never relies on the in-memory game-content cache, so it's always current.
export function listEntities<T>(entity: string): Promise<{ items: T[] }> {
  return request(`/admin/${entity}`);
}

export function getEntity<T>(entity: string, id: string): Promise<{ item: T }> {
  return request(`/admin/${entity}/${encodeURIComponent(id)}`);
}

export function createEntity<T>(entity: string, data: unknown): Promise<{ item: T }> {
  return request(`/admin/${entity}`, { method: "POST", body: JSON.stringify(data) });
}

export function updateEntity<T>(entity: string, id: string, data: unknown): Promise<{ item: T }> {
  return request(`/admin/${entity}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteEntity(entity: string, id: string): Promise<void> {
  return request(`/admin/${entity}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function activateEntity<T>(entity: string, id: string): Promise<{ item: T }> {
  return request(`/admin/${entity}/${encodeURIComponent(id)}/activate`, { method: "POST" });
}
