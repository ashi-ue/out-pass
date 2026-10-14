-- Khuruj — local development seed.
--
-- Creates one demo account per role plus students whose admission numbers are
-- the ID-card barcode values. Applied by `supabase db reset` / `supabase start`.
--
-- This is demo data for a LOCAL stack only. Never run it against a hosted
-- project that holds real student records.
--
-- Every account has the same password: Khuruj#2026

do $$
declare
  v_instance_id uuid := '00000000-0000-0000-0000-000000000000';
  v_password    text := 'Khuruj#2026';
  r             record;
  v_uid         uuid;
begin
  for r in
    select * from (values
      ('admin@khuruj.test',   'Ayesha Khan',    'admin',            null::text,          null::text),
      ('mentor@khuruj.test',  'Imran Sheikh',   'mentor',           null,                null),
      ('teacher@khuruj.test', 'Priya Menon',    'class_teacher',    null,                null),
      ('medical@khuruj.test', 'Dr. Sanjay Rao', 'medical_approver', null,                null),
      ('duty@khuruj.test',    'Neha Gupta',     'duty_teacher',     null,                null),
      ('gate@khuruj.test',    'Vikram Singh',   'gate_security',    null,                null),
      ('student@khuruj.test', 'Aarav Sharma',   'student',          '2023CS1042',        'Computer Science'),
      ('student2@khuruj.test','Fatima Noor',    'student',          '2023EC2087',        'Electronics'),
      ('student3@khuruj.test','Rahul Verma',    'student',          '2022ME3311',        'Mechanical')
    ) as t(email, full_name, role, admission_number, department)
  loop
    -- Reuse the account if the seed is run twice.
    select id into v_uid from auth.users where email = r.email;

    if v_uid is null then
      v_uid := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token,
        email_change_token_new, email_change
      ) values (
        v_instance_id, v_uid, 'authenticated', 'authenticated', r.email,
        crypt(v_password, gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', r.full_name),
        '', '', '', ''
      );

      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), v_uid, v_uid::text,
        jsonb_build_object('sub', v_uid::text, 'email', r.email,
                           'email_verified', true),
        'email', now(), now(), now()
      );
    else
      update auth.users
         set encrypted_password = crypt(v_password, gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_uid;
    end if;

    -- The on-auth-user trigger has already created the profile and granted the
    -- student role. Staff accounts must not keep a student role.
    update public.profiles
       set full_name = r.full_name, email = r.email
     where id = v_uid;

    if r.role <> 'student' then
      delete from public.user_roles
       where user_id = v_uid and role = 'student';
    end if;

    -- The admin role is granted by bootstrap_admin below, which refuses to run
    -- once an administrator already exists.
    if r.role <> 'admin' then
      insert into public.user_roles (user_id, role)
      values (v_uid, r.role::public.app_role)
      on conflict (user_id, role) do nothing;
    end if;

    if r.admission_number is not null then
      insert into public.students (
        admission_number, full_name, department, academic_year, email, user_id
      ) values (
        r.admission_number, r.full_name, r.department, 3, r.email, v_uid
      )
      on conflict (admission_number) where admission_number is not null do update
        set full_name = excluded.full_name,
            department = excluded.department,
            email = excluded.email,
            user_id = excluded.user_id,
            updated_at = now();
    end if;
  end loop;

  -- A student record with no login yet: the gate must still resolve the barcode.
  insert into public.students (admission_number, full_name, department, academic_year)
  values ('2024CE4501', 'Meera Iyer', 'Civil', 2)
  on conflict (admission_number) where admission_number is not null do nothing;

  -- The first administrator, through the documented bootstrap path.
  perform public.bootstrap_admin('admin@khuruj.test');
end $$;
