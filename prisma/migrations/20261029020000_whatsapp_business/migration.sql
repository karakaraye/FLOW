-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL DEFAULT 'whatsapp-business',
    "messagingAccountId" TEXT NOT NULL,
    "legacyWabaId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "graphVersion" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'DEVELOPER_TEST',
    "dailyLimit" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppPhone" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerPhoneId" TEXT NOT NULL,
    "displayLast4" TEXT NOT NULL,
    "verifiedName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WhatsAppPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppContact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "phoneId" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3),
    "consentSource" TEXT,
    "optedOutAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "phoneId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "recipientLast4" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "templateId" TEXT,
    "providerMessageId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'RESERVED',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "statusAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAttempt" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "statusCode" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "phoneId" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerAt" TIMESTAMP(3) NOT NULL,
    "ciphertext" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppStatus" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "providerAt" TIMESTAMP(3) NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppSubscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "phoneId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppEventRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,

    CONSTRAINT "WhatsAppEventRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_integrationId_key" ON "WhatsAppConnection"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_integrationId_workspaceId_providerId_key" ON "WhatsAppConnection"("integrationId", "workspaceId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_id_workspaceId_key" ON "WhatsAppConnection"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppPhone_providerPhoneId_key" ON "WhatsAppPhone"("providerPhoneId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppPhone_id_workspaceId_key" ON "WhatsAppPhone"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppContact_phoneId_recipientHash_key" ON "WhatsAppContact"("phoneId", "recipientHash");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppContact_id_workspaceId_key" ON "WhatsAppContact"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_providerMessageId_key" ON "WhatsAppMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_workspaceId_createdAt_idx" ON "WhatsAppMessage"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_runId_nodeId_key" ON "WhatsAppMessage"("runId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_id_workspaceId_key" ON "WhatsAppMessage"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAttempt_messageId_number_key" ON "WhatsAppAttempt"("messageId", "number");

-- CreateIndex
CREATE INDEX "WhatsAppEvent_state_createdAt_idx" ON "WhatsAppEvent"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppEvent_phoneId_dedupKey_key" ON "WhatsAppEvent"("phoneId", "dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppEvent_id_workspaceId_key" ON "WhatsAppEvent"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppStatus_eventId_key" ON "WhatsAppStatus"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSubscription_phoneId_workflowId_key" ON "WhatsAppSubscription"("phoneId", "workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppEventRun_runId_key" ON "WhatsAppEventRun"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppEventRun_eventId_workflowId_key" ON "WhatsAppEventRun"("eventId", "workflowId");

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_integrationId_workspaceId_providerId_fkey" FOREIGN KEY ("integrationId", "workspaceId", "providerId") REFERENCES "WorkspaceIntegration"("id", "workspaceId", "providerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppPhone" ADD CONSTRAINT "WhatsAppPhone_connectionId_workspaceId_fkey" FOREIGN KEY ("connectionId", "workspaceId") REFERENCES "WhatsAppConnection"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppContact" ADD CONSTRAINT "WhatsAppContact_phoneId_workspaceId_fkey" FOREIGN KEY ("phoneId", "workspaceId") REFERENCES "WhatsAppPhone"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_phoneId_workspaceId_fkey" FOREIGN KEY ("phoneId", "workspaceId") REFERENCES "WhatsAppPhone"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppAttempt" ADD CONSTRAINT "WhatsAppAttempt_messageId_workspaceId_fkey" FOREIGN KEY ("messageId", "workspaceId") REFERENCES "WhatsAppMessage"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppEvent" ADD CONSTRAINT "WhatsAppEvent_phoneId_workspaceId_fkey" FOREIGN KEY ("phoneId", "workspaceId") REFERENCES "WhatsAppPhone"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppStatus" ADD CONSTRAINT "WhatsAppStatus_messageId_workspaceId_fkey" FOREIGN KEY ("messageId", "workspaceId") REFERENCES "WhatsAppMessage"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSubscription" ADD CONSTRAINT "WhatsAppSubscription_connectionId_workspaceId_fkey" FOREIGN KEY ("connectionId", "workspaceId") REFERENCES "WhatsAppConnection"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSubscription" ADD CONSTRAINT "WhatsAppSubscription_phoneId_workspaceId_fkey" FOREIGN KEY ("phoneId", "workspaceId") REFERENCES "WhatsAppPhone"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppEventRun" ADD CONSTRAINT "WhatsAppEventRun_eventId_workspaceId_fkey" FOREIGN KEY ("eventId", "workspaceId") REFERENCES "WhatsAppEvent"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Database-level bounds and cross-tenant bindings beyond the composite phone relations.
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "wa_policy" CHECK ("providerId"='whatsapp-business' AND "messagingAccountId"="legacyWabaId" AND "dailyLimit" BETWEEN 0 AND 20 AND "mode" IN ('MOCK','DEVELOPER_TEST') AND "graphVersion"='v26.0');
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "wa_message_state" CHECK (state IN ('RESERVED','IN_FLIGHT','ACCEPTED','SENT','DELIVERED','READ','FAILED','UNKNOWN'));
ALTER TABLE "WhatsAppAttempt" ADD CONSTRAINT "wa_attempt_bounds" CHECK (number BETWEEN 1 AND 3 AND state IN ('IN_FLIGHT','UNKNOWN','REJECTED','ACCEPTED','RECONCILED_BY_STATUS'));
ALTER TABLE "WhatsAppEvent" ADD CONSTRAINT "wa_event_state" CHECK (state IN ('PENDING','PROCESSED','REJECTED','EXPIRED','UNSUPPORTED','UNMATCHED'));
ALTER TABLE "WhatsAppStatus" ADD CONSTRAINT "wa_delivery_state" CHECK (state IN ('SENT','DELIVERED','READ','FAILED'));
CREATE FUNCTION wa_tenant_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='WhatsAppMessage' THEN
  IF NOT EXISTS (SELECT 1 FROM "WorkflowRun" r JOIN "Workflow" w ON w.id=r."workflowId" WHERE r.id=NEW."runId" AND w."workspaceId"=NEW."workspaceId") THEN RAISE EXCEPTION 'WhatsApp tenant binding rejected'; END IF;
 ELSIF TG_TABLE_NAME='WhatsAppSubscription' THEN
  IF NOT EXISTS (SELECT 1 FROM "WorkflowVersion" v JOIN "Workflow" w ON w.id=v."workflowId" JOIN "WhatsAppPhone" p ON p.id=NEW."phoneId" WHERE v.id=NEW."versionId" AND w.id=NEW."workflowId" AND w."workspaceId"=NEW."workspaceId" AND p."workspaceId"=NEW."workspaceId" AND p."connectionId"=NEW."connectionId") THEN RAISE EXCEPTION 'WhatsApp subscription binding rejected'; END IF;
 ELSIF TG_TABLE_NAME='WhatsAppEventRun' THEN
  IF NOT EXISTS (SELECT 1 FROM "WorkflowRun" r JOIN "Workflow" w ON w.id=r."workflowId" WHERE r.id=NEW."runId" AND w.id=NEW."workflowId" AND w."workspaceId"=NEW."workspaceId") THEN RAISE EXCEPTION 'WhatsApp event run binding rejected'; END IF;
 ELSIF TG_TABLE_NAME='WhatsAppStatus' THEN
  IF NOT EXISTS (SELECT 1 FROM "WhatsAppEvent" e JOIN "WhatsAppMessage" m ON m.id=NEW."messageId" WHERE e.id=NEW."eventId" AND e."workspaceId"=NEW."workspaceId" AND m."phoneId"=e."phoneId" AND e.kind='STATUS') THEN RAISE EXCEPTION 'WhatsApp delivery binding rejected'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wa_message_binding BEFORE INSERT OR UPDATE ON "WhatsAppMessage" FOR EACH ROW EXECUTE FUNCTION wa_tenant_binding();
CREATE TRIGGER wa_subscription_binding BEFORE INSERT OR UPDATE ON "WhatsAppSubscription" FOR EACH ROW EXECUTE FUNCTION wa_tenant_binding();
CREATE TRIGGER wa_event_run_binding BEFORE INSERT OR UPDATE ON "WhatsAppEventRun" FOR EACH ROW EXECUTE FUNCTION wa_tenant_binding();
CREATE TRIGGER wa_status_binding BEFORE INSERT OR UPDATE ON "WhatsAppStatus" FOR EACH ROW EXECUTE FUNCTION wa_tenant_binding();
CREATE FUNCTION wa_message_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD."workspaceId",OLD."phoneId",OLD."runId",OLD."nodeId",OLD."recipientHash",OLD.kind,OLD."templateId") IS DISTINCT FROM (NEW."workspaceId",NEW."phoneId",NEW."runId",NEW."nodeId",NEW."recipientHash",NEW.kind,NEW."templateId") OR (OLD."providerMessageId" IS NOT NULL AND OLD."providerMessageId" IS DISTINCT FROM NEW."providerMessageId") THEN RAISE EXCEPTION 'WhatsApp message identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wa_message_immutable BEFORE UPDATE ON "WhatsAppMessage" FOR EACH ROW EXECUTE FUNCTION wa_message_immutable();
