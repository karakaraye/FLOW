-- Review and execute as a database administrator; never by the runtime app.
-- Inject credentials using your secret manager / psql \password, not this file.
CREATE ROLE flowpilot_migrator LOGIN;
CREATE ROLE flowpilot_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE flowpilot_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE flowpilot TO flowpilot_app, flowpilot_migrator, flowpilot_backup;
GRANT USAGE ON SCHEMA public TO flowpilot_app, flowpilot_backup;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO flowpilot_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO flowpilot_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO flowpilot_backup;
-- The migrator must own migrated objects. Configure ownership before migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE flowpilot_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO flowpilot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE flowpilot_migrator IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO flowpilot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE flowpilot_migrator IN SCHEMA public GRANT SELECT ON TABLES TO flowpilot_backup;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- Runtime shared-service role is trusted across tenants; application checks and
-- composite constraints enforce tenant boundaries. Database RLS is not claimed.
