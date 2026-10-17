export async function assertLocalModel(config,fetcher=fetch){
 const u=new URL(config.url);
 if(!config.enabled||!config.model||u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname)||u.pathname!=='/'||u.username||u.password||u.search||u.hash)throw Error('AWOS_LOCAL_MODEL_REQUIRED');
 const res=await fetcher(`${u.origin}/api/show`,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({model:config.model}),signal:AbortSignal.timeout(10_000)});
 if(!res.ok)throw Error('AWOS_LOCAL_MODEL_UNAVAILABLE');
 const d=await res.json();if(!d||typeof d!=='object'||d.remote_host||d.remote_model||!d.model_info||!Object.keys(d.model_info).length||config.model.endsWith(':cloud'))throw Error('AWOS_REMOTE_MODEL_DENIED');
 return {url:u.origin,model:config.model};
}
