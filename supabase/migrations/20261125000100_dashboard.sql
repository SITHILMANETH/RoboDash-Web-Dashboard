CREATE TABLE IF NOT EXISTS public.dashboard_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  value JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.dashboard_state ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.dashboard_state TO anon, authenticated;
GRANT INSERT, UPDATE ON public.dashboard_state TO authenticated;

DROP POLICY IF EXISTS "Public can read dashboard state" ON public.dashboard_state;
CREATE POLICY "Public can read dashboard state"
  ON public.dashboard_state FOR SELECT TO anon, authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Configured admin can insert dashboard state" ON public.dashboard_state;
CREATE POLICY "Configured admin can insert dashboard state"
  ON public.dashboard_state FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'email' = 'simaneth@gmail.com');

DROP POLICY IF EXISTS "Configured admin can update dashboard state" ON public.dashboard_state;
CREATE POLICY "Configured admin can update dashboard state"
  ON public.dashboard_state FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'email' = 'simaneth@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'simaneth@gmail.com');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dashboard-media',
  'dashboard-media',
  TRUE,
  52428800,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public can read dashboard media" ON storage.objects;
CREATE POLICY "Public can read dashboard media"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'dashboard-media');

DROP POLICY IF EXISTS "Configured admin can upload dashboard media" ON storage.objects;
CREATE POLICY "Configured admin can upload dashboard media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dashboard-media'
    AND auth.jwt() ->> 'email' = 'simaneth@gmail.com'
  );

DROP POLICY IF EXISTS "Configured admin can update dashboard media" ON storage.objects;
CREATE POLICY "Configured admin can update dashboard media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'dashboard-media'
    AND auth.jwt() ->> 'email' = 'simaneth@gmail.com'
  )
  WITH CHECK (
    bucket_id = 'dashboard-media'
    AND auth.jwt() ->> 'email' = 'simaneth@gmail.com'
  );

DROP POLICY IF EXISTS "Configured admin can delete dashboard media" ON storage.objects;
CREATE POLICY "Configured admin can delete dashboard media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'dashboard-media'
    AND auth.jwt() ->> 'email' = 'simaneth@gmail.com'
  );
