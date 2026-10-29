BEGIN;
CREATE OR REPLACE FUNCTION "protect_template_version"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Published template versions are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "AutomationTemplateVersion_immutable" BEFORE UPDATE OR DELETE ON "AutomationTemplateVersion"
FOR EACH ROW EXECUTE FUNCTION "protect_template_version"();
ALTER TABLE "AutomationTemplate" ADD CONSTRAINT "AutomationTemplate_positive_revision" CHECK (revision > 0);
ALTER TABLE "AutomationTemplateVersion" ADD CONSTRAINT "AutomationTemplateVersion_positive_number" CHECK (number > 0);

COMMIT;
