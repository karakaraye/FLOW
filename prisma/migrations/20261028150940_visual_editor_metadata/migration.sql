-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "editor" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "WorkflowVersion" ADD COLUMN     "editor" JSONB NOT NULL DEFAULT '{}';
