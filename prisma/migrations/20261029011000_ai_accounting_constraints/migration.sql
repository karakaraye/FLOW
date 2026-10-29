BEGIN;
ALTER TABLE "AIWorkspaceBudget" ADD CONSTRAINT ai_budget_nonnegative CHECK ("dailyLimitMicros">=0 AND "monthlyLimitMicros">=0 AND revision>0);
ALTER TABLE "AIUsage" ADD CONSTRAINT ai_amounts_nonnegative CHECK ("reservedMicros">0 AND "accountedMicros">=0 AND ("estimatedCostMicros" IS NULL OR "estimatedCostMicros">=0) AND "inputTokenBound">0 AND "maxOutputTokens" BETWEEN 16 AND 2048 AND revision>0);
ALTER TABLE "AIUsage" ADD CONSTRAINT ai_usage_counts CHECK (("inputTokens" IS NULL OR "inputTokens">=0) AND ("outputTokens" IS NULL OR "outputTokens">=0) AND ("totalTokens" IS NULL OR "totalTokens"="inputTokens"+"outputTokens"));
ALTER TABLE "AIUsage" ADD CONSTRAINT ai_usage_sources CHECK (source IN ('WORKFLOW','PLAYGROUND') AND provider='openai' AND mode IN ('LIVE','MOCK') AND "accountingSource" IN ('RESERVATION','PROVIDER_USAGE','NO_USAGE','MANUAL'));
CREATE FUNCTION protect_ai_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "WorkflowRun" r JOIN "Workflow" w ON w.id=r."workflowId" WHERE r.id=NEW."runId" AND w."workspaceId"=NEW."workspaceId") THEN RAISE EXCEPTION 'AI tenant binding mismatch'; END IF;
 IF TG_OP='UPDATE' AND (OLD."workspaceId",OLD."runId",OLD."nodeId",OLD.provider,OLD.model,OLD."modelId",OLD.pricing,OLD."reservedMicros",OLD.day,OLD.month) IS DISTINCT FROM (NEW."workspaceId",NEW."runId",NEW."nodeId",NEW.provider,NEW.model,NEW."modelId",NEW.pricing,NEW."reservedMicros",NEW.day,NEW.month) THEN RAISE EXCEPTION 'AI request binding and pricing are immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ai_binding_guard BEFORE INSERT OR UPDATE ON "AIUsage" FOR EACH ROW EXECUTE FUNCTION protect_ai_binding();
CREATE FUNCTION protect_ai_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'AI budget audit records are immutable';
END;
$$;
CREATE TRIGGER ai_events_immutable BEFORE UPDATE OR DELETE ON "AIBudgetEvent" FOR EACH ROW EXECUTE FUNCTION protect_ai_events();
COMMIT;
