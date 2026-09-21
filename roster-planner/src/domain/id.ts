// © 2026 David Juste. All rights reserved. Proprietary and confidential.

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
