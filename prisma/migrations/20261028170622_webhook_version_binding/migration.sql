-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_versionId_workflowId_fkey" FOREIGN KEY ("versionId", "workflowId") REFERENCES "WorkflowVersion"("id", "workflowId") ON DELETE CASCADE ON UPDATE CASCADE;
