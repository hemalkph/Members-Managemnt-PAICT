-- =============================================================================
-- Marking: a "Full paper marking" rate (MCQ + Essay of one paper marked by the
-- same person), next to "MCQ paper marking" and "Essay paper marking".
-- Seeded at Rs 0 – main admins set the price in Rates & budget.
-- (No DROP statements, so it runs without confirmation.)
-- =============================================================================

insert into public.rate_items (role_id, name, unit, price, sort_order)
select r.id, 'Full paper marking', 'paper', 0, 19
from public.roles r
where r.name ilike '%marking%'
  and not exists (
    select 1 from public.rate_items ri where ri.role_id = r.id and lower(ri.name) = 'full paper marking'
  );
