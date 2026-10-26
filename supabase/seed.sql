-- =============================================================================
-- Team Work Tracker — seed data
--   * Sections and roles (safe to run more than once)
--   * Four SAMPLE members + sample submissions for the current month.
--     All sample members use the password:  Password123!
--     Delete them before real use (Authentication > Users in Supabase).
-- Run this AFTER the migrations (Supabase SQL editor, or `supabase db reset`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Sections & roles
-- -----------------------------------------------------------------------------
insert into public.sections (name, description, sort_order) values
  ('Paper Panel', 'Creating, converting and marking papers', 1),
  ('Payment Clearance', 'Checking student payments on WhatsApp and the LMS', 2),
  ('Creative & Operations', 'Design, type setting and physical class coordination', 3)
on conflict (lower(name)) do nothing;

insert into public.roles (section_id, name, sort_order)
select s.id, r.name, r.sort_order
from (values
  ('Paper Panel', 'Paper Marking Admin', 1),
  ('Paper Panel', 'Paper Creating Team', 2),
  ('Paper Panel', 'Paper Converting Team', 3),
  ('Payment Clearance', 'WhatsApp Admin', 1),
  ('Payment Clearance', 'LMS Admin', 2),
  ('Creative & Operations', 'Graphic Design', 1),
  ('Creative & Operations', 'Type Setting', 2),
  ('Creative & Operations', 'Physical Coordinator', 3)
) as r(section_name, name, sort_order)
join public.sections s on lower(s.name) = lower(r.section_name)
on conflict (section_id, lower(name)) do nothing;

-- -----------------------------------------------------------------------------
-- Pay rates: prices start at Rs. 0 — set them in the app (Admin > Rates & budget).
-- WhatsApp Admin and LMS Admin are paid a fixed salary.
-- -----------------------------------------------------------------------------
update public.roles set is_salaried = true where name in ('WhatsApp Admin', 'LMS Admin');

insert into public.rate_items (role_id, name, unit, price, sort_order)
select r.id, v.item, v.unit, 0, v.sort_order
from (values
  ('Type Setting',          'Page',                                  'page',   1),
  ('Graphic Design',        'Thumbnail',                             'design', 1),
  ('Graphic Design',        'Flyer',                                 'design', 2),
  ('Graphic Design',        'Banner',                                'design', 3),
  ('Graphic Design',        'Template',                              'design', 4),
  ('Paper Creating Team',   'Paper',                                 'paper',  1),
  ('Paper Creating Team',   'Marking scheme',                        'scheme', 2),
  ('Paper Converting Team', 'Paper translation (Sinhala → English)', 'page',   1),
  ('Paper Converting Team', 'Tute translation (Sinhala → English)',  'page',   2)
) as v(role_name, item, unit, sort_order)
join public.roles r on r.name = v.role_name
on conflict (role_id, lower(name)) do nothing;

-- -----------------------------------------------------------------------------
-- Sample members (auth users). The on_auth_user_created trigger creates profiles.
-- -----------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('Password123!', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(), now(), '', '', '', ''
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'nimal.perera@example.com',     'Nimal Perera'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'kavindi.silva@example.com',    'Kavindi Silva'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'tharindu.fernando@example.com','Tharindu Fernando'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'sachini.jaya@example.com',     'Sachini Jayasinghe')
) as u(id, email, full_name)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
)
and not exists (
  select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
);

-- NIC numbers fill in date_of_birth automatically (profiles_birth_date_from_nic trigger).
update public.profiles p set
  phone = v.phone,
  whatsapp = v.whatsapp,
  nic = v.nic
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, '0771234567', '0771234567', '200512345678'),
  ('22222222-2222-4222-8222-222222222222'::uuid, '0712345678', '0712345678', '200680012345'),
  ('33333333-3333-4333-8333-333333333333'::uuid, '0763456789', '0763456789', '200402512345'),
  ('44444444-4444-4444-8444-444444444444'::uuid, '0754567890', '0754567890', '200575512345')
) as v(id, phone, whatsapp, nic)
where p.id = v.id;

insert into public.bank_details (user_id, bank_name, branch, account_holder, account_number) values
  ('11111111-1111-4111-8111-111111111111', 'Bank of Ceylon', 'Kandy', 'N. Perera', '0081234567'),
  ('22222222-2222-4222-8222-222222222222', 'Commercial Bank', 'Colombo 07', 'K. Silva', '8001234589')
on conflict (user_id) do nothing;

-- -----------------------------------------------------------------------------
-- Role assignments (members can hold several roles)
-- -----------------------------------------------------------------------------
insert into public.member_roles (user_id, role_id)
select a.user_id, r.id
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'Paper Marking Admin'),
  ('11111111-1111-4111-8111-111111111111'::uuid, 'Paper Creating Team'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'Graphic Design'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'Type Setting'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'WhatsApp Admin'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'LMS Admin'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'Paper Converting Team'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'Physical Coordinator')
) as a(user_id, role_name)
join public.roles r on r.name = a.role_name
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Sample submissions (current month + last month)
-- -----------------------------------------------------------------------------
insert into public.submissions (user_id, role_id, work_month, title, description, quantity, date_done, status, admin_comment, reviewed_at)
select
  s.user_id,
  r.id,
  (date_trunc('month', current_date) + make_interval(months => s.month_offset))::date,
  s.title,
  s.description,
  s.quantity,
  (date_trunc('month', current_date) + make_interval(months => s.month_offset, days => s.day_offset))::date,
  s.status::public.submission_status,
  s.admin_comment,
  case when s.status = 'pending' then null else now() end
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'Paper Marking Admin',  0, 2, 'Marked Term Test 1 papers',      'Batch A and B structured essay answers', 45, 'approved', 'Great work, thank you!'),
  ('11111111-1111-4111-8111-111111111111'::uuid, 'Paper Creating Team',  0, 5, 'Created MCQ paper on networking', '50 MCQs covering OSI and TCP/IP',          1, 'pending',  null),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'Graphic Design',       0, 1, 'Class poster designs',            'Posters for the revision seminar',         3, 'approved', null),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'Type Setting',         0, 6, 'Typeset tute: Databases',         'SQL tute, 24 pages',                       1, 'pending',  null),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'WhatsApp Admin',       0, 3, 'Cleared WhatsApp payments',       'Verified slips from the class group',     38, 'pending',  null),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'LMS Admin',            0, 4, 'LMS enrolments',                  'Enrolled paid students to the LMS',       52, 'rejected', 'Please add the student list as an attachment.'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'Paper Converting Team',0, 2, 'Converted papers to Google Forms', null,                                     4, 'approved', null),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'Physical Coordinator', -1, 10, 'Coordinated Kandy hall class',   'Attendance and handouts',                  1, 'approved', 'Thanks!'),
  ('11111111-1111-4111-8111-111111111111'::uuid, 'Paper Marking Admin', -1, 12, 'Marked monthly test papers',      null,                                     60, 'approved', null),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'Graphic Design',      -1, 8,  'Social media banners',            'Facebook and WhatsApp banners',            6, 'approved', null)
) as s(user_id, role_name, month_offset, day_offset, title, description, quantity, status, admin_comment)
join public.roles r on r.name = s.role_name
where not exists (
  select 1 from public.submissions x where x.user_id = s.user_id and x.title = s.title
);

-- Work types for the sample submissions (amount = quantity × rate).
update public.submissions s set rate_item_id = i.id
from public.rate_items i
where i.role_id = s.role_id and s.rate_item_id is null
  and (s.title, i.name) in (
    ('Created MCQ paper on networking', 'Paper'),
    ('Class poster designs', 'Flyer'),
    ('Social media banners', 'Banner'),
    ('Typeset tute: Databases', 'Page'),
    ('Converted papers to Google Forms', 'Paper translation (Sinhala → English)')
  );

-- -----------------------------------------------------------------------------
-- First admin: sign up / invite yourself, then run (with your own email):
--   update public.profiles set is_admin = true, is_main_admin = true where email = 'you@example.com';
-- (Main admins also see Analytics and can change pay rates.)
-- -----------------------------------------------------------------------------
