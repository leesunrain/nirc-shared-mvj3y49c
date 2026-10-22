import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
const URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON=Deno.env.get('SUPABASE_ANON_KEY')!;
const admin=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const out=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:cors});
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function coach(req:Request){const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!token)throw Error('감독자 로그인이 필요합니다');const {data,error}=await admin.auth.getUser(token);if(error||!data.user)throw Error('감독자 로그인이 필요합니다');const p=await admin.from('profiles').select('role').eq('user_id',data.user.id).maybeSingle();if(p.error||p.data?.role!=='coach')throw Error('감독자만 등록코드를 발급할 수 있습니다');}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return out({error:'POST only'},405);
 try{
  const b=await req.json(),action=String(b.action||''),slot=Number(b.slot);
  if(!Number.isInteger(slot)||slot<1||slot>7)return out({error:'선수 번호를 확인하세요.'},400);
  const a=await admin.from('athletes').select('id,slot,name,active').eq('slot',slot).maybeSingle();
  if(a.error||!a.data?.active)return out({error:'등록되지 않은 선수 번호입니다.'},404);
  const athlete=a.data;
  if(action==='issue'){
    await coach(req);
    const bytes=crypto.getRandomValues(new Uint8Array(10));
    const abc='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code=Array.from(bytes,x=>abc[x%abc.length]).join('');
    const code_hash=await hash(code);
    const {error}=await admin.from('athlete_access').upsert({athlete_id:athlete.id,code_hash,code_expires_at:new Date(Date.now()+14*86400000).toISOString(),code_used_at:null},{onConflict:'athlete_id'});
    if(error)throw Error('코드 발급 실패: '+error.message);
    return out({code,slot,name:athlete.name,expires_days:14});
  }
  if(action==='enroll'){
    const code=String(b.code||'').trim().toUpperCase().replace(/[-\s]/g,'');
    const password=String(b.password||'');
    if(!/^[A-Z2-9]{10}$/.test(code))return out({error:'10자리 등록코드를 확인하세요.'},400);
    if(password.length<10||password.length>128)return out({error:'비밀번호는 10~128자로 설정하세요.'},400);
    const row=await admin.from('athlete_access').select('*').eq('athlete_id',athlete.id).maybeSingle();
    if(row.error||!row.data?.code_hash||row.data.code_used_at||Date.parse(row.data.code_expires_at)<Date.now()||await hash(code)!==row.data.code_hash)return out({error:'등록코드가 틀렸거나 만료됐습니다. 감독자에게 새 코드를 요청하세요.'},403);
    const synthetic=`maruta-${athlete.id}@login.example.com`;
    let uid=row.data.auth_user_id;
    if(uid){
      const updated=await admin.auth.admin.updateUserById(uid,{password,email_confirm:true});
      if(updated.error)throw Error('비밀번호 변경 실패: '+updated.error.message);
    }else{
      const created=await admin.auth.admin.createUser({email:synthetic,password,email_confirm:true});
      if(created.error||!created.data.user)throw Error('계정 생성 실패: '+(created.error?.message||''));
      uid=created.data.user.id;
    }
    const existing=await admin.from('profiles').select('user_id').eq('athlete_id',athlete.id).maybeSingle();
    if(existing.error)throw Error('선수 연결 확인 실패');
    if(existing.data&&existing.data.user_id!==uid)throw Error('이미 다른 계정과 연결된 선수입니다. 감독자에게 문의하세요.');
    const prof=await admin.from('profiles').upsert({user_id:uid,athlete_id:athlete.id,role:'athlete'},{onConflict:'user_id'});
    if(prof.error)throw Error('프로필 연결 실패: '+prof.error.message);
    const saved=await admin.from('athlete_access').update({auth_user_id:uid,code_hash:null,code_used_at:new Date().toISOString()}).eq('athlete_id',athlete.id).eq('code_hash',row.data.code_hash).is('code_used_at',null).select('athlete_id');
    if(saved.error||!saved.data?.length)throw Error('등록코드 사용 처리 실패. 감독자에게 문의하세요.');
    const auth=await admin.auth.signInWithPassword({email:synthetic,password});
    if(auth.error||!auth.data.session)throw Error('계정 생성 후 로그인 실패. 선수 로그인에서 다시 시도하세요.');
    return out({access_token:auth.data.session.access_token,refresh_token:auth.data.session.refresh_token});
  }
  if(action==='login'){
    const password=String(b.password||'');if(!password)return out({error:'비밀번호를 입력하세요.'},400);
    const row=await admin.from('athlete_access').select('auth_user_id').eq('athlete_id',athlete.id).maybeSingle();
    if(row.error||!row.data?.auth_user_id)return out({error:'아직 등록되지 않았습니다. 처음 등록하기를 눌러주세요.'},401);
    const synthetic=`maruta-${athlete.id}@login.example.com`;
    // Authenticate via standard Supabase Auth password verification; no admin-generated sessions.
    const client=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
    const result=await client.auth.signInWithPassword({email:synthetic,password});
    if(result.error||!result.data.session)return out({error:'비밀번호가 올바르지 않습니다.'},401);
    return out({access_token:result.data.session.access_token,refresh_token:result.data.session.refresh_token});
  }
  return out({error:'지원하지 않는 요청입니다.'},400);
 }catch(e){return out({error:e instanceof Error?e.message:'서버 오류'},400)}
});
