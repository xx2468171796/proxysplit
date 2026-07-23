// Production serves the admin SPA and API from the same HTTPS origin.  Local
// development still injects VITE_API_URL from server/.env.
const BASE=import.meta.env.VITE_API_URL??''
let token=sessionStorage.getItem('ps-admin-token')||''
export const setToken=(v:string)=>{token=v;v?sessionStorage.setItem('ps-admin-token',v):sessionStorage.removeItem('ps-admin-token')}
export const hasToken=()=>!!token
export async function api<T>(path:string,init:RequestInit={}):Promise<T>{const headers=new Headers(init.headers);headers.set('content-type','application/json');if(token)headers.set('authorization','Bearer '+token);const res=await fetch(BASE+path,{...init,headers});const data=await res.json().catch(()=>({}));if(!res.ok){if(res.status===401)setToken('');throw new Error(data?.error?.message||`HTTP ${res.status}`)}return data as T}
export async function login(username:string,password:string){let fp=localStorage.getItem('ps-admin-device');if(!fp){fp=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');localStorage.setItem('ps-admin-device',fp)}const data=await api<{accessToken:string}>('/v1/auth/login',{method:'POST',body:JSON.stringify({username,password,device:{fingerprint:fp,name:'运营后台',platform:'windows',appVersion:'1.9.0'}})});setToken(data.accessToken)}
