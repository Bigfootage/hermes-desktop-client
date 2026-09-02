import { invoke } from '@tauri-apps/api/core';
export type PhaseDStatus={enabled:boolean;state:string;cua_version?:string;session_id?:number;daemon_reachable:boolean;tunnel_alive:boolean;adapter_connected:boolean;last_heartbeat_ms?:number;last_error?:string;manifest_digest:string;audit_bytes:number};
export const phaseDStatus=()=>invoke<PhaseDStatus>('phase_d_status');
export const enablePhaseD=()=>invoke<PhaseDStatus>('phase_d_enable');
export const disablePhaseD=(forget=false)=>invoke<PhaseDStatus>('phase_d_disable',{forget});
export const testPhaseD=()=>invoke<string>('phase_d_test');
