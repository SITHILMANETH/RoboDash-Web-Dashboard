CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.admin_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_users TO service_role;

CREATE OR REPLACE FUNCTION public.current_admin_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM public.admin_users
  WHERE user_id = auth.uid()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.current_admin_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_admin_role() TO authenticated;

DROP POLICY IF EXISTS "Admins can read admin registry" ON public.admin_users;
CREATE POLICY "Admins can read admin registry"
  ON public.admin_users FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_admin_role() = 'super_admin');

INSERT INTO public.admin_users (user_id, email, role)
SELECT id, lower(email), 'super_admin'
FROM auth.users
WHERE lower(email) = 'simaneth@gmail.com'
ON CONFLICT (user_id) DO UPDATE
SET email = EXCLUDED.email, role = 'super_admin';

DROP POLICY IF EXISTS "Configured admin can insert dashboard state" ON public.dashboard_state;
CREATE POLICY "Admins can insert dashboard state"
  ON public.dashboard_state FOR INSERT TO authenticated
  WITH CHECK (public.current_admin_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "Configured admin can update dashboard state" ON public.dashboard_state;
CREATE POLICY "Admins can update dashboard state"
  ON public.dashboard_state FOR UPDATE TO authenticated
  USING (public.current_admin_role() IN ('admin', 'super_admin'))
  WITH CHECK (public.current_admin_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "Configured admin can upload dashboard media" ON storage.objects;
CREATE POLICY "Admins can upload dashboard media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dashboard-media'
    AND public.current_admin_role() IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS "Configured admin can update dashboard media" ON storage.objects;
CREATE POLICY "Admins can update dashboard media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'dashboard-media'
    AND public.current_admin_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    bucket_id = 'dashboard-media'
    AND public.current_admin_role() IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS "Configured admin can delete dashboard media" ON storage.objects;
CREATE POLICY "Admins can delete dashboard media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'dashboard-media'
    AND public.current_admin_role() IN ('admin', 'super_admin')
  );
