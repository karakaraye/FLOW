ALTER TABLE "WorkerHeartbeat" ADD CONSTRAINT worker_health_state CHECK (status IN ('STARTING','IDLE','BUSY','STOPPING','STOPPED','ERROR'));
ALTER TABLE "OperationalMetric" ADD CONSTRAINT operational_metric_bounds CHECK (count>0 AND status BETWEEN 100 AND 599 AND route IN ('workspace','auth','catalog','flow-webhook','meta-webhook','billing-webhook','google-callback','server'));
