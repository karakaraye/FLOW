BEGIN;
CREATE FUNCTION "protect_integration_audit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Integration audit history is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "IntegrationAuditEvent_immutable" BEFORE UPDATE OR DELETE ON "IntegrationAuditEvent"
FOR EACH ROW EXECUTE FUNCTION "protect_integration_audit"();
ALTER TABLE "WorkspaceIntegration" ADD CONSTRAINT "WorkspaceIntegration_revision_positive" CHECK (revision > 0);
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_generation_positive" CHECK (generation > 0);
ALTER TABLE "IntegrationAuditEvent" ADD CONSTRAINT "IntegrationAuditEvent_safe_code" CHECK (code IS NULL OR code IN ('AUTHENTICATION_FAILED','TOKEN_EXPIRED','PROVIDER_OPERATION_FAILED','CREDENTIAL_CONFIGURATION_UNAVAILABLE','CREDENTIAL_UNAVAILABLE','AUTH_ATTEMPT_EXPIRED','AUTH_BINDING_INVALID','LOCAL_ACCESS_REMOVED'));
ALTER TABLE "WorkspaceIntegration" ADD CONSTRAINT "WorkspaceIntegration_safe_error_code" CHECK ("lastErrorCode" IS NULL OR "lastErrorCode" IN ('AUTHENTICATION_FAILED','TOKEN_EXPIRED','PROVIDER_OPERATION_FAILED','CREDENTIAL_CONFIGURATION_UNAVAILABLE','CREDENTIAL_UNAVAILABLE','AUTH_ATTEMPT_EXPIRED','AUTH_BINDING_INVALID'));
COMMIT;
