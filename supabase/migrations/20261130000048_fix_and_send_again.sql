-- =============================================================================
-- Fix rejected work or a sent-back task and send it again. Safe to run twice.
--
-- * A member can edit their own rejected work. Saving it sends it back to
--   review (status pending) and stamps resubmitted_at, so reviewers can see it
--   was fixed. The admin's reason stays on the row until the next review.
-- * Admins get the usual "waiting for review" message when work is sent again.
-- * Work in a closed month still can't change (guard_closed_month).
-- =============================================================================

alter table public.submissions add column if not exists resubmitted_at timestamptz;

-- Same as migration 043, plus the member's rejected → pending step.
create or replace function public.guard_submission_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  acting_user uuid := (select auth.uid());
  reviewing boolean;
begin
  -- SQL editor / service role (no auth.uid()) is trusted.
  if acting_user is null then
    return new;
  end if;

  if public.is_admin() then
    -- A review is any status or comment change, or adding work that is not pending.
    reviewing := case
      when tg_op = 'INSERT' then new.status <> 'pending' or new.admin_comment is not null
      else new.status is distinct from old.status or new.admin_comment is distinct from old.admin_comment
    end;
    if reviewing then
      if not public.has_page('review', true) then
        raise exception 'You need edit access to Work review to review work' using errcode = '42501';
      end if;
      if new.user_id = acting_user and not public.is_main_admin() then
        raise exception 'You can''t review your own work. Ask another admin.' using errcode = '42501';
      end if;
    end if;
    if tg_op = 'INSERT' then
      if new.status = 'pending' then
        new.reviewed_by := null;
        new.reviewed_at := null;
      else
        new.reviewed_by := acting_user;
        new.reviewed_at := now();
      end if;
    elsif new.status is distinct from old.status then
      if new.status = 'pending' then
        new.reviewed_by := null;
        new.reviewed_at := null;
      else
        new.reviewed_by := acting_user;
        new.reviewed_at := now();
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.admin_comment := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.resubmitted_at := null;
    return new;
  end if;

  -- UPDATE by a member
  if old.status = 'rejected' and new.status = 'pending' then
    -- Fixed and sent again: keep the admin's reason for the next reviewer.
    if new.admin_comment is distinct from old.admin_comment
       or new.user_id is distinct from old.user_id then
      raise exception 'Members cannot change review fields' using errcode = '42501';
    end if;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.resubmitted_at := now();
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'Only pending submissions can be edited' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     or new.admin_comment is distinct from old.admin_comment
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.resubmitted_at is distinct from old.resubmitted_at
     or new.user_id is distinct from old.user_id then
    raise exception 'Members cannot change review fields' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_submission_changes() from public, anon, authenticated;

-- Members may now update their own rejected work too (it must come out pending).
drop policy if exists "submissions: update own while pending" on public.submissions;
drop policy if exists "submissions: update own while pending or rejected" on public.submissions;
create policy "submissions: update own while pending or rejected"
  on public.submissions for update to authenticated
  using (user_id = (select auth.uid()) and status in ('pending', 'rejected'))
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and public.is_active_member()
    and exists (
      select 1 from public.member_roles mr
      where mr.user_id = (select auth.uid()) and mr.role_id = submissions.role_id
    )
  );

-- Same as migration 009, plus: work sent again tells the admins.
create or replace function public.notify_submissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  pending_count integer;
  member_name text;
  admin_row record;
  resent boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return null;
    end if;
    resent := actor is not distinct from new.user_id and old.status = 'rejected' and new.status = 'pending';
    if not resent then
      if actor is not distinct from new.user_id then
        return null;
      end if;
      perform public.notify(
        new.user_id,
        'submission.' || case new.status when 'pending' then 'reopened' else new.status::text end,
        case new.status
          when 'approved' then 'Your work was approved'
          when 'rejected' then 'Your work was not approved'
          else 'Your work is back in review'
        end,
        '"' || new.title || '"'
          || case when new.status = 'approved' and new.amount is not null and new.amount > 0
               then ' · ' || public.lkr(new.amount) else '' end
          || case when new.status = 'rejected' and new.admin_comment is not null
               then ' · ' || new.admin_comment else '' end,
        '/work?month=' || public.month_key(new.work_month)
      );
      return null;
    end if;
  end if;

  -- New work, or rejected work sent again
  select count(*) into pending_count from public.submissions where status = 'pending';
  member_name := coalesce(public.profile_name(new.user_id), 'A member');
  for admin_row in
    select id from public.profiles where is_admin and is_active and id is distinct from new.user_id
  loop
    update public.notifications
    set title = pending_count || ' submission' || case when pending_count = 1 then '' else 's' end || ' waiting for review',
        body = 'Latest: ' || member_name || ' – "' || new.title || '"' || case when resent then ' (fixed and sent again)' else '' end,
        created_at = now()
    where user_id = admin_row.id and kind = 'review.pending' and read_at is null;
    if not found then
      perform public.notify(
        admin_row.id, 'review.pending',
        pending_count || ' submission' || case when pending_count = 1 then '' else 's' end || ' waiting for review',
        'Latest: ' || member_name || ' – "' || new.title || '"' || case when resent then ' (fixed and sent again)' else '' end,
        '/admin/review?status=pending'
      );
    end if;
  end loop;
  return null;
end;
$$;

revoke execute on function public.notify_submissions() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Tasks: an admin can send finished work back with a reason. The member fixes
-- it (uploads the right file), then marks the task done again.
-- -----------------------------------------------------------------------------
alter table public.tasks add column if not exists fix_note text check (char_length(fix_note) <= 1000);
alter table public.tasks add column if not exists sent_back_at timestamptz;

-- Same as migration 041, plus: members can't change fix_note / sent_back_at.
create or replace function public.guard_task_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- current_user is 'authenticated' for direct API calls; inside the paper flow
  -- functions (security definer) it is their owner, which is trusted.
  if (select auth.uid()) is not null and current_user = 'authenticated' and not public.has_page('tasks', true) then
    if new.title is distinct from old.title or new.description is distinct from old.description
       or new.assignee_id is distinct from old.assignee_id or new.role_id is distinct from old.role_id
       or new.exam_id is distinct from old.exam_id or new.centre_id is distinct from old.centre_id
       or new.quantity is distinct from old.quantity or new.due_date is distinct from old.due_date
       or new.priority is distinct from old.priority or new.paper_stage_id is distinct from old.paper_stage_id
       or new.created_by is distinct from old.created_by
       or new.type_id is distinct from old.type_id or new.details is distinct from old.details
       or new.fix_note is distinct from old.fix_note or new.sent_back_at is distinct from old.sent_back_at then
      raise exception 'Only admins can change task details' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not (
         (old.status = 'open' and new.status = 'done')
         or (old.status = 'done' and new.status = 'open' and old.paper_stage_id is null)
       ) then
      raise exception 'You can only mark an open task as done' using errcode = '42501';
    end if;
  end if;
  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done' then now() else null end;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_task_changes() from public, anon, authenticated;

-- Tell the member their task came back, with the reason.
create or replace function public.notify_task_sent_back()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'open' and new.sent_back_at is distinct from old.sent_back_at and new.sent_back_at is not null then
    perform public.notify(new.assignee_id, 'task.sent_back', 'Fix and send again: ' || new.title,
      coalesce(new.fix_note, 'An admin sent this task back.'), public.task_link(new));
    perform public.write_activity('task.sent_back', 'task', new.id::text, new.assignee_id,
      'Sent "' || new.title || '" back to fix', jsonb_build_object('reason', new.fix_note));
  end if;
  return null;
end;
$$;

revoke execute on function public.notify_task_sent_back() from public, anon, authenticated;

create or replace trigger tasks_notify_sent_back
  after update on public.tasks
  for each row execute function public.notify_task_sent_back();
