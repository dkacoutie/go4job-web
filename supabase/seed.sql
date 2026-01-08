insert into public.job_sources (name)
values ('Remotive')
on conflict (name) do nothing;
