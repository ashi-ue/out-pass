-- ============================================================================
-- Khuruj (خروج) — 0006 teacher roles and a leaner student record
-- ----------------------------------------------------------------------------
-- Two changes requested after the first hosted deployment.
--
-- 1. A teacher is one person with one login, but the work of approving passes
--    is split across three duties (afternoon outings, going home, Thursday /
--    Friday). An account may therefore hold several roles at once, and any of
--    them may approve. The scope check does NOT weaken: `app.can_decide()`
--    still refuses anyone who does not hold the type's configured approver
--    role (or admin), and it already compares against the caller's whole role
--    set, so no change to it is needed.
--
-- 2. Student records only need admission number, class, name and department.
--    `class_name` is added as the human label ("3rd Year, CSE"); the numeric
--    `academic_year` is kept and stays in step so existing data and reports do
--    not change shape. `program`, `email` and `phone` were already nullable and
--    simply stop being collected — no stored value is ever wiped.
--
-- SAFETY CONTRACT
--   * Additive and repeatable (idempotent). Never drops, truncates or
--     overwrites existing tables or data. No stored value is ever cleared.
--   * The only DROP is of the superseded 7-argument `admin_upsert_student`
--     function signature, so the 8-argument replacement is unambiguous. A
--     function carries no data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A human-readable class label on a student
-- ---------------------------------------------------------------------------
alter table public.students add column if not exists class_name text;

comment on column public.students.class_name is
  'Class label, e.g. "3rd Year, CSE". Mirrored to academic_year when the label starts with a number, so the two never disagree.';

-- ---------------------------------------------------------------------------
-- 2. admin_upsert_student gains the class label
-- ---------------------------------------------------------------------------
-- The 7-argument version is dropped so a caller passing a class name cannot
-- bind to the old signature by mistake.
drop function if exists public.admin_upsert_student(
  text, text, text, text, int, text, text);

create or replace function public.admin_upsert_student(
  p_admission_number text,
  p_full_name        text,
  p_department       text default null,
  p_program          text default null,
  p_academic_year    int  default null,
  p_email            text default null,
  p_phone            text default null,
  p_class_name       text default null
) returns public.students
language plpgsql security definer set search_path = ''
as $$
declare
  v_row   public.students;
  v_class text := nullif(btrim(coalesce(p_class_name, '')), '');
  v_year  int  := p_academic_year;
begin
  if not app.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_admission_number is null or length(btrim(p_admission_number)) = 0 then
    raise exception 'ADMISSION_REQUIRED' using errcode = 'P0001';
  end if;

  -- Keep the label and the number in step. A leading integer in the label wins
  -- ("3rd Year, CSE" -> 3), so the two can never contradict each other.
  if v_class is not null and v_class ~ '^[0-9]+' then
    v_year := (regexp_match(v_class, '^([0-9]+)'))[1]::int;
  end if;

  insert into public.students as s
    (admission_number, full_name, department, program, academic_year, email,
     phone, class_name)
  values
    (btrim(p_admission_number), p_full_name, p_department, p_program,
     v_year, p_email, p_phone, v_class)
  -- The uniqueness of students.admission_number is a PARTIAL index
  -- (where admission_number is not null), so the conflict target must repeat
  -- that predicate. Without it Postgres cannot infer the index and errors with
  -- "there is no unique or exclusion constraint matching the ON CONFLICT
  -- specification".
  on conflict (admission_number) where admission_number is not null do update
    set full_name     = coalesce(excluded.full_name, s.full_name),
        department    = coalesce(excluded.department, s.department),
        program       = coalesce(excluded.program, s.program),
        academic_year = coalesce(excluded.academic_year, s.academic_year),
        email         = coalesce(excluded.email, s.email),
        phone         = coalesce(excluded.phone, s.phone),
        class_name    = coalesce(excluded.class_name, s.class_name),
        updated_at    = now()
  returning * into v_row;

  perform app.write_audit('student_upserted', 'student', v_row.id::text,
    v_row.admission_number, jsonb_build_object(
      'full_name', v_row.full_name,
      'class_name', v_row.class_name));

  return v_row;
end $$;

revoke all on function public.admin_upsert_student(
  text, text, text, text, int, text, text, text) from public, anon;
grant execute on function public.admin_upsert_student(
  text, text, text, text, int, text, text, text) to authenticated;
