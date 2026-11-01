let accessToken=null;
let refreshPromise;
const base=import.meta.env.VITE_API_BASE || '/api';
export const clearToken=()=>{accessToken=null;};
export async function api(path,{method='GET',body}={},retry=true) {
 const response=await fetch(`${base}${path}`,{method,credentials:'include',headers:{...(body?{'Content-Type':'application/json'}:{}),...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(response.status===401 && retry && !path.startsWith('/auth/')) {
  await restore();return api(path,{method,body},false);
 }
 const data=response.status===204?null:await response.json();
 if(!response.ok) throw new Error(data?.message || 'Request failed');
 if(data?.accessToken) accessToken=data.accessToken;
 return data;
}
export function restore() {
 if(!refreshPromise) refreshPromise=api('/auth/refresh',{method:'POST'},false).finally(()=>{refreshPromise=null;});
 return refreshPromise;
}
