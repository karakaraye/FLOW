-- Published snapshots cannot be edited even through accidental direct ORM calls.
-- Deletion is reserved for parent workspace/workflow lifecycle cascades; there
-- are no public workflow/version deletion endpoints in this release.
CREATE FUNCTION "reject_workflow_version_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published workflow versions are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "WorkflowVersion_immutable" BEFORE UPDATE ON "WorkflowVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_workflow_version_update"();
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_positive_revision" CHECK (revision > 0);
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_positive_number" CHECK (number > 0);
