BEGIN;
ALTER TABLE "BillingCheckout" ADD CONSTRAINT billing_checkout_bounds CHECK (tier IN ('STARTER','BUSINESS','PRO') AND interval IN ('monthly','annually') AND "amountMinor">0 AND currency='NGN' AND status IN ('INITIALIZING','OPEN','UNKNOWN','PAID_PENDING_SUBSCRIPTION','ACTIVE','PAID_REQUIRES_REVIEW'));
ALTER TABLE "BillingPayment" ADD CONSTRAINT billing_payment_bounds CHECK ("amountMinor">0 AND currency='NGN' AND "periodEnd">"paidAt");
ALTER TABLE "Subscription" ADD CONSTRAINT billing_subscription_mode CHECK (provider IS NULL OR (provider='PAYSTACK' AND mode='TEST' AND interval IN ('monthly','annually') AND currency='NGN' AND "amountMinor">0 AND revision>0));
ALTER TABLE "QuotaEntry" ADD CONSTRAINT quota_bounds CHECK (amount>=0 AND metric IN ('executions','aiMicros','messages') AND period ~ '^\d{4}-(0[1-9]|1[0-2])$' AND (metric='aiMicros' OR amount=1));
ALTER TABLE "BillingEvent" ADD CONSTRAINT billing_event_bounds CHECK (attempts>=0 AND status IN ('PENDING','RUNNING','PROCESSED','UNMATCHED','NEEDS_REVIEW','IGNORED'));
CREATE UNIQUE INDEX billing_subscription_workspace_code ON "Subscription"("providerCode","workspaceId");
ALTER TABLE "BillingPayment" ADD CONSTRAINT billing_payment_tenant FOREIGN KEY ("subscriptionCode","workspaceId") REFERENCES "Subscription"("providerCode","workspaceId") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION billing_immutable_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Billing evidence is append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER billing_audit_immutable BEFORE UPDATE OR DELETE ON "BillingAudit" FOR EACH ROW EXECUTE FUNCTION billing_immutable_audit();
CREATE TRIGGER billing_payment_immutable BEFORE UPDATE OR DELETE ON "BillingPayment" FOR EACH ROW EXECUTE FUNCTION billing_immutable_audit();
CREATE FUNCTION billing_checkout_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD."workspaceId",OLD."requestedBy",OLD."emailHash",OLD."idempotencyKey",OLD."requestHash",OLD.reference,OLD.tier,OLD.interval,OLD."amountMinor",OLD.currency,OLD."providerPlanCode",OLD."providerPlanId") IS DISTINCT FROM (NEW."workspaceId",NEW."requestedBy",NEW."emailHash",NEW."idempotencyKey",NEW."requestHash",NEW.reference,NEW.tier,NEW.interval,NEW."amountMinor",NEW.currency,NEW."providerPlanCode",NEW."providerPlanId") OR (OLD."subscriptionCode" IS NOT NULL AND OLD."subscriptionCode" IS DISTINCT FROM NEW."subscriptionCode") OR (OLD."providerTransactionId" IS NOT NULL AND OLD."providerTransactionId" IS DISTINCT FROM NEW."providerTransactionId") THEN RAISE EXCEPTION 'Checkout identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_checkout_immutable BEFORE UPDATE ON "BillingCheckout" FOR EACH ROW EXECUTE FUNCTION billing_checkout_immutable();
CREATE FUNCTION quota_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD."workspaceId",OLD.period,OLD.metric,OLD.key) IS DISTINCT FROM (NEW."workspaceId",NEW.period,NEW.metric,NEW.key) THEN RAISE EXCEPTION 'Quota identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quota_identity_immutable BEFORE UPDATE ON "QuotaEntry" FOR EACH ROW EXECUTE FUNCTION quota_identity_immutable();
CREATE FUNCTION execution_lease_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "WorkflowRun" r JOIN "Workflow" w ON w.id=r."workflowId" WHERE r.id=NEW."runId" AND w."workspaceId"=NEW."workspaceId") THEN RAISE EXCEPTION 'Execution lease tenant binding rejected'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_lease_tenant BEFORE INSERT OR UPDATE ON "ExecutionLease" FOR EACH ROW EXECUTE FUNCTION execution_lease_tenant();
-- Preserve current and historical usage when enabling centralized quotas.
INSERT INTO "QuotaEntry" (id,"workspaceId",period,metric,key,amount,"createdAt","updatedAt") SELECT 'backfill-run-'||r.id,w."workspaceId",to_char(r."createdAt" AT TIME ZONE 'UTC','YYYY-MM'),'executions',r.id,1,r."createdAt",NOW() FROM "WorkflowRun" r JOIN "Workflow" w ON w.id=r."workflowId" ON CONFLICT DO NOTHING;
INSERT INTO "QuotaEntry" (id,"workspaceId",period,metric,key,amount,"createdAt","updatedAt") SELECT 'backfill-ai-'||id,"workspaceId",month,'aiMicros',"runId"||':'||"nodeId","accountedMicros","createdAt",NOW() FROM "AIUsage" ON CONFLICT DO NOTHING;
INSERT INTO "QuotaEntry" (id,"workspaceId",period,metric,key,amount,"createdAt","updatedAt") SELECT 'backfill-wa-'||id,"workspaceId",to_char("createdAt" AT TIME ZONE 'UTC','YYYY-MM'),'messages',"runId"||':'||"nodeId",1,"createdAt",NOW() FROM "WhatsAppMessage" ON CONFLICT DO NOTHING;
INSERT INTO "QuotaEntry" (id,"workspaceId",period,metric,key,amount,"createdAt","updatedAt") SELECT 'backfill-gmail-'||MIN(a.id),w."workspaceId",to_char(MIN(a."createdAt") AT TIME ZONE 'UTC','YYYY-MM'),'messages',r.id||':'||a."nodeId",1,MIN(a."createdAt"),NOW() FROM "HttpAttempt" a JOIN "WorkflowRun" r ON r.id=a."runId" JOIN "Workflow" w ON w.id=r."workflowId" JOIN "WorkflowVersion" v ON v.id=r."versionId" WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition->'nodes') n WHERE n->>'id'=a."nodeId" AND n->>'type'='gmail_send_email') GROUP BY w."workspaceId",r.id,a."nodeId" ON CONFLICT DO NOTHING;
COMMIT;
