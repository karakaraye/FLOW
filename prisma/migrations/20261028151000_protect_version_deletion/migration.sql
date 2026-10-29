CREATE OR REPLACE FUNCTION "reject_workflow_version_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Tenant/workflow teardown can cascade deletes. Direct snapshot deletion and
  -- all updates are forbidden, including those made outside the application.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Published workflow versions are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "WorkflowVersion_no_direct_delete" BEFORE DELETE ON "WorkflowVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_workflow_version_update"();
