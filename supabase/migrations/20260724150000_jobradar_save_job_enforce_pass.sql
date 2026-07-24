-- Ajoute une verification serveur d'abonnement actif dans save_job().
-- Contexte : la sauvegarde d'offre ("Sauvegarder") est presentee comme un
-- avantage payant (copy client + gate cote UI dans addToApplications), mais
-- la fonction RPC SECURITY DEFINER ne verifiait aucun statut d'abonnement :
-- un appel direct a l'API (hors UI) aurait permis a un compte gratuit de
-- sauvegarder des offres sans restriction. On reutilise le helper existant
-- has_active_pass(uuid), deja utilise ailleurs dans le schema, pour rendre
-- la restriction reelle et pas seulement visuelle. Comportement inchange
-- pour tout utilisateur passant par l'UI actuelle (le gate client bloquait
-- deja l'appel avant meme d'atteindre le serveur).

begin;

create or replace function public.save_job(p_job_id uuid)
returns table(ok boolean, application_id bigint, status text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_app_id bigint;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not public.has_active_pass(v_user_id) then
    raise exception 'PASS_REQUIRED';
  end if;

  insert into public.applications(user_id, job_id, status)
  values (v_user_id, p_job_id, 'saved')
  on conflict (user_id, job_id)
  do update set status = 'saved'
  returning applications.id, applications.status
  into v_app_id, v_status;

  ok := true;
  application_id := v_app_id;
  status := v_status;
  return next;
end;
$function$;

commit;
