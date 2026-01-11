# Migration 001: Initial Schema

**Version:** 1
**Name:** initial_schema
**Date:** 2024-01-01
**Author:** CFX-DB Team

## Description

Initial database schema with core tables:
- `players` - Player data storage
- `keyValue` - Generic key-value store
- `auditLogs` - Audit logging for all operations
- `_migrations` - Migration history tracking

## Changes

### Added Tables

#### `players`
```typescript
defineTable({
    identifier: v.string(),
    name: v.string(),
    firstJoin: v.number(),
    lastSeen: v.number(),
    online: v.optional(v.boolean()),
    money: v.optional(v.number()),
    bank: v.optional(v.number()),
})
.index("by_identifier", ["identifier"])
.index("by_online", ["online"])
.index("by_money", ["money"])
```

**Purpose:** Store player data with fast lookups by identifier

**Indexes:**
- `by_identifier` - Prevents duplicate players in upsert operations
- `by_online` - Query online players efficiently
- `by_money` - Support leaderboards

#### `keyValue`
```typescript
defineTable({
    key: v.string(),
    value: v.any(),
    updatedAt: v.number(),
})
.index("by_key", ["key"])
```

**Purpose:** Generic key-value store for simple settings/flags

**Indexes:**
- `by_key` - Unique key lookups

#### `auditLogs`
```typescript
defineTable({
    operation: v.string(),
    table: v.string(),
    resourceName: v.string(),
    playerId: v.optional(v.string()),
    data: v.optional(v.any()),
    where: v.optional(v.any()),
    results: v.optional(v.any()),
    timestamp: v.number(),
    duration: v.number(),
    success: v.boolean(),
    error: v.optional(v.string()),
})
.index("by_timestamp", ["timestamp"])
.index("by_table", ["table", "timestamp"])
.index("by_resource", ["resourceName", "timestamp"])
.index("by_player", ["playerId", "timestamp"])
.index("by_operation", ["operation", "timestamp"])
```

**Purpose:** Track all database operations for security/debugging

**Indexes:**
- `by_timestamp` - Query logs chronologically
- `by_table` - Filter logs by table
- `by_resource` - Track resource activity
- `by_player` - Player-specific audit trail
- `by_operation` - Filter by operation type

#### `_migrations`
```typescript
defineTable({
    version: v.number(),
    name: v.string(),
    appliedAt: v.number(),
    success: v.boolean(),
    error: v.optional(v.string()),
})
.index("by_version", ["version"])
```

**Purpose:** Track applied migrations

**Indexes:**
- `by_version` - Prevent duplicate migrations

## Deployment

This migration is applied automatically when deploying cfx-db for the first time.
The schema is defined in `convex/schema.ts` and deployed via `npx convex deploy`.

## Rollback

To rollback this migration, you would need to:
1. Delete all data from the tables
2. Remove the table definitions from schema.ts
3. Deploy the updated schema with `npx convex deploy`

**WARNING:** This will delete all data. Always backup before rolling back!

## Notes

- All tables use Convex's automatic `_id` field
- `_creationTime` is automatically tracked by Convex
- Indexes are critical for performance and preventing race conditions
- The `by_identifier` index on `players` prevents duplicate player records during concurrent upserts
