export class HermesApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string, public readonly retryAfter?: string) { super(message); this.name = 'HermesApiError'; }
}

export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  return secrets.filter((s): s is string => Boolean(s)).reduce((out, secret) => out.split(secret).join('[REDACTED]'), text);
}
