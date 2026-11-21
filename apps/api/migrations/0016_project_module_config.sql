-- A project's module configuration, edited from the web instead of a TypeScript file.
--
-- Nullable on purpose: existing projects keep working with the starter configuration,
-- and a project is never blocked because it has not been configured yet. The API renders
-- the effective configuration (project fields + these modules) and validates it with the
-- same schema the CLI uses, so the two surfaces cannot describe different products.
ALTER TABLE projects ADD COLUMN module_config TEXT;
