-- =============================================================================
-- Task types get an animated icon and a colour (picked from a grid in the app).
-- icon: the icon's name, e.g. 'clapperboard' (older types may hold an emoji).
-- color: one of the colours below. Safe to run twice.
-- =============================================================================

alter table public.task_types add column if not exists color text not null default 'blue';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'task_types_color_check') then
    alter table public.task_types add constraint task_types_color_check
      check (color in ('blue', 'sky', 'emerald', 'violet', 'rose', 'amber', 'indigo', 'teal', 'orange', 'purple', 'slate'));
  end if;
end;
$$;

-- Icon names are longer than an emoji.
alter table public.task_types drop constraint if exists task_types_icon_check;
alter table public.task_types add constraint task_types_icon_check check (char_length(icon) <= 40);
