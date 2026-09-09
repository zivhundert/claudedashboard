-- Member location (ISO 3166-1 alpha-2), set from Manage teams. Nullable —
-- roster syncs never write it, so an admin's choice survives every sync.
ALTER TABLE users ADD COLUMN country TEXT;
