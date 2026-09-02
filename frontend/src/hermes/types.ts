export interface HermesConnectionProfile { baseUrl: string; apiKey?: string; allowInsecure?: boolean }
export interface HermesCapabilities { version?: string; profile?: string; model?: string; features: Record<string, boolean>; raw: Record<string, unknown> }
export type HermesResponseOutputItem = { id?: string; type: string; text?: string; name?: string; arguments?: unknown; output?: unknown; [key: string]: unknown }
export interface HermesResponse { id: string; status?: string; output?: HermesResponseOutputItem[]; conversation?: string | { id: string }; [key: string]: unknown }
export interface HermesRun { id: string; status: string; [key: string]: unknown }
export interface HermesRunEvent { id?: string; type: string; data?: unknown; [key: string]: unknown }
export interface HermesSession { id: string; title?: string; source?: string; profile?: string; [key: string]: unknown }
export interface HermesSessionMessage { id?: string; role: string; content: unknown; [key: string]: unknown }
export interface HermesJob { id: string; status?: string; name?: string; [key: string]: unknown }
export interface HermesModelOption { id: string; provider?: string; [key: string]: unknown }
export interface HermesApprovalRequest { id: string; status?: string; tool?: string; [key: string]: unknown }
