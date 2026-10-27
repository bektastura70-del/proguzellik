
export const API_URL = process.env.API_URL ?? "http://localhost:4000";
export const TOKEN_COOKIE = "pg_token";
export const TENANT_COOKIE = "pg_tenant";

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 8,
};
