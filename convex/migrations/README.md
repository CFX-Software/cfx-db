# CFX-DB Migration System

The migration system helps you track and manage database schema changes over time.

## How Migrations Work

Unlike traditional SQL migrations, Convex handles schema deployment automatically. This migration system:
1. **Tracks** what schema changes have been applied
2. **Documents** the evolution of your database schema
3. **Provides** a history for rollback reference

**Important:** Convex automatically migrates data when you deploy schema changes. This system is for tracking and documentation, not for running migration code.

## Migration Workflow

### 1. Create a New Migration

```bash
bun run migrate:create add_vehicles_table
```

This creates a new migration file in `convex/migrations/` with the next version number.

### 2. Edit the Migration File

Open the generated `.md` file and document your schema changes:
- List all tables being added
- Document field changes
- Note any index additions/removals

### 3. Update Schema

Edit `convex/schema.ts` to add your new tables or modify existing ones:

```typescript
export default defineSchema({
    // ... existing tables

    vehicles: defineTable({
        owner: v.string(),
        plate: v.string(),
        model: v.string(),
        garage: v.optional(v.string()),
    })
        .index("by_owner", ["owner"])
        .index("by_plate", ["plate"]),
});
```

### 4. Deploy to Convex

```bash
npx convex deploy
```

Convex will automatically migrate the data based on your schema changes.

### 5. Record the Migration

```bash
bun run migrate:record 2 add_vehicles_table
```

This records the migration in the `_migrations` table for tracking.

## Migration Commands

### View Migration Status

```bash
bun run migrate:status
```

Shows:
- Current schema version
- Total migrations applied
- Success/failure counts
- Migration history

### List All Migrations

```bash
bun run migrate:list
```

Displays detailed information about all applied migrations.

### Create a Migration

```bash
bun run migrate:create <name>
```

Creates a new migration file with the next version number.

### Record a Migration

```bash
bun run migrate:record <version> <name>
```

Records a migration as applied in the database.

## Migration File Format

Each migration is a Markdown file with:

```markdown
# Migration 002: Add Vehicles Table

**Version:** 2
**Name:** add_vehicles_table
**Date:** 2024-01-15
**Author:** Your Name

## Description
Brief description of changes

## Changes
### Added Tables
- `vehicles`: Store player vehicle data

### Modified Tables
- None

## Deployment
Steps to apply this migration

## Rollback
Steps to rollback if needed

## Notes
Additional notes
```

## Best Practices

### 1. Always Document Changes
- Write clear descriptions in migration files
- Explain WHY changes were made, not just WHAT
- Document rollback procedures

### 2. Test Before Production
- Test schema changes in development first
- Use `npx convex dev` for local testing
- Deploy to production with `npx convex deploy --prod`

### 3. Backup Before Major Changes
- Take snapshots before large migrations
- Test rollback procedures
- Keep recent backups

### 4. Atomic Changes
- One logical change per migration
- Don't combine unrelated schema changes
- Makes rollback easier

### 5. Index Considerations
- Add indexes BEFORE adding large amounts of data
- Indexes prevent race conditions in concurrent operations
- The `by_identifier` pattern prevents duplicates

## Rollback Strategy

Convex doesn't support automatic rollbacks. To rollback:

1. **Create a new migration** that reverses the changes
2. **Document the rollback** in the new migration file
3. **Update schema.ts** to remove/revert changes
4. **Deploy** the updated schema
5. **Record** the rollback migration

Example rollback migration:

```bash
bun run migrate:create rollback_vehicles_table
# Edit the file to document removal of vehicles table
# Update schema.ts to remove vehicles table
npx convex deploy
bun run migrate:record 3 rollback_vehicles_table
```

## Migration History

| Version | Name | Description | Date |
|---------|------|-------------|------|
| 1 | initial_schema | Base schema with players, keyValue, auditLogs | 2024-01-01 |

Add new migrations to this table as you create them.

## Troubleshooting

### Migration Already Exists
If you get "migration already recorded" error, check with:
```bash
bun run migrate:list
```

### Failed Migration
View failed migrations:
```bash
bun run migrate:status
```

To retry a failed migration:
1. Fix the issue in your schema
2. Deploy again: `npx convex deploy`
3. The migration record is already there, no need to record again

### Delete a Migration Record
**WARNING:** Only do this if you know what you're doing!

Use the Convex dashboard to manually delete from `_migrations` table.

## Examples

### Adding a New Table

```bash
# 1. Create migration
bun run migrate:create add_inventory_table

# 2. Edit migration file with details

# 3. Update schema.ts
inventory: defineTable({
    playerId: v.string(),
    item: v.string(),
    count: v.number(),
})
    .index("by_player", ["playerId"])
    .index("by_item", ["item"])

# 4. Deploy
npx convex deploy

# 5. Record
bun run migrate:record 4 add_inventory_table
```

### Adding an Index

```bash
# 1. Create migration
bun run migrate:create add_player_name_index

# 2. Edit migration file

# 3. Update schema.ts
players: defineTable({
    // ... existing fields
})
    .index("by_identifier", ["identifier"])
    .index("by_online", ["online"])
    .index("by_money", ["money"])
    .index("by_name", ["name"])  // NEW INDEX

# 4. Deploy
npx convex deploy

# 5. Record
bun run migrate:record 5 add_player_name_index
```

## Integration with CI/CD

For automated deployments:

```bash
#!/bin/bash
# deploy.sh

# Deploy schema
npx convex deploy --prod

# Auto-record migration (if version/name provided)
if [ -n "$MIGRATION_VERSION" ] && [ -n "$MIGRATION_NAME" ]; then
    bun run migrate:record $MIGRATION_VERSION $MIGRATION_NAME
fi
```

## FAQs

**Q: Do I need to write migration code?**
A: No! Convex handles data migration automatically based on schema changes. This system just tracks what changed.

**Q: Can I skip recording a migration?**
A: Yes, but it's not recommended. Recording helps with documentation and troubleshooting.

**Q: What happens if I deploy without recording?**
A: The schema changes still apply. You just won't have a record in `_migrations`.

**Q: Can I edit an old migration file?**
A: The files are just documentation, so yes. But don't change already-applied schema changes.

**Q: How do I handle data migration?**
A: Write a separate script using the Convex API to transform data, or use the bulk operations API.
