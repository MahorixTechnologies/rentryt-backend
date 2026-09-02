-- Postgres requires a generated column's expression to be IMMUTABLE.
-- Two builtins used here are only STABLE on this Postgres build (confirmed
-- via pg_proc.provolatile), not IMMUTABLE, so both need a trivial wrapper
-- function that explicitly asserts IMMUTABLE -- safe here since this app
-- never changes text search config or array-joining behavior at runtime:
--   - to_tsvector(regconfig, text): the config-name lookup is STABLE.
--   - array_to_string(text[], text): confirmed provolatile='s' here.
CREATE OR REPLACE FUNCTION immutable_english_tsvector(text) RETURNS tsvector AS $$
  SELECT to_tsvector('english', $1);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION immutable_array_to_string(text[], text) RETURNS text AS $$
  SELECT array_to_string($1, $2);
$$ LANGUAGE sql IMMUTABLE;

-- Convert the plain "searchVector" column (added in the previous migration
-- with no generation logic, before its intended content was applied to this
-- database) into a real generated/stored full-text search column. STORED
-- means Postgres computes and maintains it automatically on every
-- insert/update -- nothing in application code writes to it directly. Title
-- matches are weighted above location, above amenities, above description.
ALTER TABLE "Listing" DROP COLUMN "searchVector";

ALTER TABLE "Listing" ADD COLUMN "searchVector" tsvector
GENERATED ALWAYS AS (
  setweight(immutable_english_tsvector(coalesce(title, '')), 'A') ||
  setweight(immutable_english_tsvector(coalesce(location, '')), 'B') ||
  setweight(immutable_english_tsvector(immutable_array_to_string(amenities, ' ')), 'C') ||
  setweight(immutable_english_tsvector(coalesce(description, '')), 'D')
) STORED;

CREATE INDEX "Listing_searchVector_idx" ON "Listing" USING GIN ("searchVector");
