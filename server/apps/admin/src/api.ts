// Production serves the admin SPA and API from the same HTTPS origin.  Local
// development still injects VITE_API_URL from server/.env.
const BASE=import.meta.env.VITE_API_URL??''
let token=sessionStorage.getItem('ps-admin-token')||''
export const setToken=(v:string)=>{token=v;v?sessionStorage.setItem('ps-admin-token',v):sessionStorage.removeItem('ps-admin-token')}
export const hasToken=()=>!!token
export async function api<T>(path:string,init:RequestInit={}):Promise<T>{const headers=new Headers(init.headers);headers.set('content-type','application/json');if(token)headers.set('authorization','Bearer '+token);const res=await fetch(BASE+path,{...init,headers});const data=await res.json().catch(()=>({}));if(!res.ok){
  // A stale/invalid token or an un-activated device must bounce back to login —
  // otherwise every list silently 403s and the console looks empty ("data lost").
  const code=(data as any)?.error?.code;
  if(res.status===401||code==='ACCESS_INVALID'||code==='DEVICE_ACTIVATION_REQUIRED'){const had=hasToken();setToken('');if(had)location.reload()}
  throw new Error(data?.error?.message||`HTTP ${res.status}`)}return data as T}
export async function login(username:string,password:string){let fp=localStorage.getItem('ps-admin-device');if(!fp){fp=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');localStorage.setItem('ps-admin-device',fp)}const data=await api<{accessToken:string;deviceLimitReached?:boolean}>('/v1/auth/login',{method:'POST',body:JSON.stringify({username,password,device:{fingerprint:fp,name:'运营后台',platform:'windows',appVersion:'1.9.0'}})});
  // A device-limit login returns a 15-min pending token that cannot read admin
  // data. Never store it — surface the reason on the login form instead.
  if(data.deviceLimitReached||!data.accessToken)throw new Error('设备名额已满，请先在其他设备解绑，或联系管理员');
  setToken(data.accessToken)}
