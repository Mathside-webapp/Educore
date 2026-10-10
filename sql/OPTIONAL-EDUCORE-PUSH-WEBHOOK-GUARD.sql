-- Run in EDUCORE Supabase SQL editor only (optional), after backing up schema.
-- This guards against webhook calls for accounts without registered devices.
-- It does not delete notifications, users, records, subscriptions or alter current device keys.
BEGIN;
CREATE SCHEMA IF NOT EXISTS classside_private;
CREATE OR REPLACE FUNCTION classside_private.push_subscription_exists(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT EXISTS(SELECT 1 FROM public.classside_push_subscriptions WHERE user_id=p_user_id);
$fn$;
REVOKE ALL ON FUNCTION classside_private.push_subscription_exists(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION classside_private.push_subscription_exists(uuid) TO authenticated,service_role,postgres;
DO $fn$
DECLARE existing_definition text; updated_definition text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO existing_definition
  FROM pg_trigger t WHERE t.tgrelid='public.classside_notifications'::regclass
    AND t.tgname='educore-push-notifications' AND NOT t.tgisinternal;
  IF existing_definition IS NULL THEN
    RAISE EXCEPTION 'EduCore push webhook missing, no changes made';
  END IF;
  IF position('push_subscription_exists' in existing_definition)>0 THEN RETURN; END IF;
  updated_definition := replace(existing_definition, 'FOR EACH ROW EXECUTE FUNCTION',
    'FOR EACH ROW WHEN (classside_private.push_subscription_exists(NEW.user_id)) EXECUTE FUNCTION');
  IF updated_definition=existing_definition THEN RAISE EXCEPTION 'Unexpected webhook format'; END IF;
  EXECUTE 'DROP TRIGGER "educore-push-notifications" ON public.classside_notifications';
  EXECUTE updated_definition;
END
$fn$;
COMMIT;
