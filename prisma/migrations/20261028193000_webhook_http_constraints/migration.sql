BEGIN;
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_positive_revision" CHECK (revision > 0);
ALTER TABLE "WebhookRate" ADD CONSTRAINT "WebhookRate_bounded" CHECK (count BETWEEN 1 AND 61);
ALTER TABLE "HttpAttempt" ADD CONSTRAINT "HttpAttempt_bounded_number" CHECK (number BETWEEN 1 AND 3);
ALTER TABLE "HttpAttempt" ADD CONSTRAINT "HttpAttempt_valid_state" CHECK (state IN ('IN_FLIGHT','SUCCEEDED','FAILED','AMBIGUOUS'));
CREATE FUNCTION protect_webhook_records() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Webhook delivery and audit records are immutable';
END;
$$;
CREATE TRIGGER webhook_delivery_immutable BEFORE UPDATE OR DELETE ON "WebhookDelivery" FOR EACH ROW EXECUTE FUNCTION protect_webhook_records();
CREATE TRIGGER webhook_audit_immutable BEFORE UPDATE OR DELETE ON "WebhookAudit" FOR EACH ROW EXECUTE FUNCTION protect_webhook_records();
COMMIT;
