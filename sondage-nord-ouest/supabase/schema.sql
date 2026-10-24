-- Version Supabase (éditeur SQL). Squelette sécurisé, NON branché au frontend local.
create extension if not exists pgcrypto;
create table profiles(id uuid primary key references auth.users on delete restrict,display_name text,role text not null default 'user' check(role in('user','admin','editor')),is_active bool default true,created_at timestamptz default now());
create table arrondissements(id uuid primary key default gen_random_uuid(),name text unique not null);
create table communes(id uuid primary key default gen_random_uuid(),arrondissement_id uuid references arrondissements,name text unique not null,is_active bool default true);
create table political_parties(id uuid primary key default gen_random_uuid(),name text unique not null,acronym text,status text default 'published');
create table candidates(id uuid primary key default gen_random_uuid(),first_name text not null,last_name text not null,photo_url text,party_id uuid references political_parties,position_type text not null check(position_type in('depute','magistrat_communal','casec','senateur')),commune_id uuid references communes,biography text,program_summary text,publication_status text not null default 'draft' check(publication_status in('draft','published','archived')),created_at timestamptz default now());
create table polls(id uuid primary key default gen_random_uuid(),title text not null,position_type text not null,commune_id uuid references communes,participation_mode text not null default 'public' check(participation_mode in('public','account')),status text not null default 'draft' check(status in('draft','published','suspended','closed','archived')),starts_at timestamptz not null,ends_at timestamptz not null,results_visibility text not null default 'after_close' check(results_visibility in('hidden','live','after_close')),minimum_publication_count int default 0,check(ends_at>starts_at));
create table poll_candidates(poll_id uuid references polls,candidate_id uuid references candidates,primary key(poll_id,candidate_id));
create table poll_responses(id uuid primary key default gen_random_uuid(),poll_id uuid not null references polls,candidate_id uuid not null,participant_user_id uuid references auth.users,anonymous_key_hash text,created_at timestamptz default now(),foreign key(poll_id,candidate_id) references poll_candidates,unique(poll_id,participant_user_id),unique(poll_id,anonymous_key_hash));
create table audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid,action text,entity_type text,metadata jsonb,created_at timestamptz default now());

create function is_admin() returns bool language sql security definer stable set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and role='admin' and is_active)$$;
create function guard_role() returns trigger language plpgsql security definer as $$begin if new.role<>'user' and not is_admin() and auth.uid() is not null then raise exception 'interdit';end if;return new;end$$;
create trigger t_guard before insert or update on profiles for each row execute function guard_role();

alter table profiles enable row level security;alter table arrondissements enable row level security;alter table communes enable row level security;alter table political_parties enable row level security;alter table candidates enable row level security;alter table polls enable row level security;alter table poll_candidates enable row level security;alter table poll_responses enable row level security;alter table audit_logs enable row level security;
create policy pub_arr on arrondissements for select using(true);
create policy pub_com on communes for select using(is_active);
create policy pub_par on political_parties for select using(status='published');
create policy pub_can on candidates for select using(publication_status='published');
create policy pub_pol on polls for select using(status in('published','closed'));
create policy pub_pc on poll_candidates for select using(true);
create policy own_prof on profiles for select using(id=auth.uid() or is_admin());
create policy adm_arr on arrondissements for all using(is_admin());create policy adm_com on communes for all using(is_admin());create policy adm_par on political_parties for all using(is_admin());create policy adm_can on candidates for all using(is_admin());create policy adm_pol on polls for all using(is_admin());create policy adm_pc on poll_candidates for all using(is_admin());
create policy adm_log on audit_logs for select using(is_admin());
-- poll_responses : aucune policy => aucun accès direct.

create function cast_vote(p_poll uuid,p_cand uuid,p_key text default null) returns text language plpgsql security definer set search_path=public as $$
declare v polls;begin
 select * into v from polls where id=p_poll and status='published' and now() between starts_at and ends_at;
 if not found then raise exception 'Sondage fermé ou non commencé';end if;
 if not exists(select 1 from poll_candidates pc join candidates c on c.id=pc.candidate_id where pc.poll_id=p_poll and pc.candidate_id=p_cand and c.publication_status='published') then raise exception 'Candidat non autorisé';end if;
 if v.participation_mode='account' then
  if auth.uid() is null then raise exception 'Connexion requise';end if;
  insert into poll_responses(poll_id,candidate_id,participant_user_id) values(p_poll,p_cand,auth.uid());
 else
  if p_key is null or length(p_key)<32 then raise exception 'Clé invalide';end if;
  insert into poll_responses(poll_id,candidate_id,anonymous_key_hash) values(p_poll,p_cand,encode(digest(p_key,'sha256'),'hex'));
 end if;return 'ok';
exception when unique_violation then raise exception 'Participation déjà enregistrée';end$$;
grant execute on function cast_vote to anon,authenticated;

create function poll_results(p_poll uuid) returns table(candidate_id uuid,n bigint,total bigint) language sql security definer set search_path=public as $$
 with p as(select * from polls where id=p_poll and status in('published','closed') and results_visibility<>'hidden' and(results_visibility='live' or status='closed' or now()>ends_at)),
 t as(select count(*) tot from poll_responses where poll_id=p_poll)
 select pc.candidate_id,(select count(*) from poll_responses r where r.poll_id=p_poll and r.candidate_id=pc.candidate_id),t.tot from poll_candidates pc,t,p where pc.poll_id=p_poll and t.tot>=p.minimum_publication_count$$;
grant execute on function poll_results to anon,authenticated;
-- 1er admin : créer l'utilisateur dans Authentication > Users, puis dans l'éditeur SQL :
-- insert into profiles(id,role) values('<UUID>','admin');
