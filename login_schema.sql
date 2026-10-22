-- 마루타 간편 로그인: 기존 선수, 훈련, 감독자 계정 보존
create table if not exists public.athlete_access (
 athlete_id uuid primary key references public.athletes(id) on delete cascade,
 auth_user_id uuid unique references auth.users(id) on delete set null,
 code_hash text,
 code_expires_at timestamptz,
 code_used_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.athlete_access enable row level security;
revoke all on public.athlete_access from anon,authenticated;
-- 서버 Edge Function은 서비스 역할로만 접근. 선수 코드/비밀번호는 브라우저 DB에 노출하지 않음.
create or replace function public.maruta_roster()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('slot',slot,'name',name) order by slot),'[]'::jsonb)
 from public.athletes where active=true and slot between 1 and 7;
$$;
revoke all on function public.maruta_roster() from public;
grant execute on function public.maruta_roster() to anon,authenticated;
