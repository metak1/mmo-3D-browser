import { ClassId } from "@mmo/shared";

const API_URL = import.meta.env.VITE_SERVER_HTTP_URL ?? "http://localhost:2567";

export interface PublicUser {
  id: number;
  username: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

export interface CharacterSummary {
  id: number;
  user_id: number;
  name: string;
  class_id: ClassId;
  level: number;
  xp: number;
  main_stat: number;
  vitality: number;
  luck: number;
  armor: number;
  created_at: string;
}

export class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(body?.error ?? `Request failed with status ${res.status}`);
  }

  return body as T;
}

export function register(username: string, email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, email, password }),
  });
}

export function login(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function me(token: string): Promise<{ user: PublicUser }> {
  return request("/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function listCharacters(token: string): Promise<{ characters: CharacterSummary[] }> {
  return request("/characters", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function createCharacter(
  token: string,
  name: string,
  classId: ClassId,
): Promise<{ character: CharacterSummary }> {
  return request("/characters", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, classId }),
  });
}
