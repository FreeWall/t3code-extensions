/** Narrowing helpers for the untyped JSON the app and the wire hand us. */

export type Json = Record<string, unknown>;

export const record = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;

export const string = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
