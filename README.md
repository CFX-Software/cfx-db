# CFX-DB

> Simple Convex database integration for FiveM

**Stop fighting with SQL.** Use Convex's real-time database from your FiveM server with production-grade features built-in.

## Why CFX-DB?

- ✅ **Just Works** - `DB.insert()`, `DB.select()`, `DB.update()`, `DB.delete()` - that's it
- ✅ **Real-time by Default** - Convex automatically syncs data changes
- ✅ **Fast** - Query caching, connection pooling, write batching
- ✅ **Production Ready** - Transactions, audit logs, snapshots, monitoring
- ✅ **Type-safe** - Full TypeScript support
- ✅ **Dual API** - Use from Lua or JavaScript

## Quick Start

📚 **Full installation guide:** https://www.cfx.software/docs/cfx-db

```bash
# 1. Install dependencies (REQUIRED before setting up Convex)
bun install

# 2. Set up Convex (use the npm script, NOT bunx)
bun run convex:dev

# 3. Build
bun run build

# Add to server.cfg
ensure yarn
ensure cfx-db
```

> ⚠️ **Important:** Do NOT use `bunx convex dev` directly - it will fail to resolve imports.
> Always use `bun run convex:dev` which uses the locally installed convex package.

## Basic Usage

### Simple CRUD

```lua
-- Insert
DB.insert('players', {
    identifier = 'license:abc123',
    name = 'John Doe',
    money = 5000
}, function(insertId, err)
    if not err then
        print("Inserted:", insertId)
    end
end)

-- Select
local player = DB.selectOne('players', {
    where = {identifier = 'license:abc123'}
})

-- Update
DB.update('players', {
    where = {identifier = 'license:abc123'},
    set = {money = 6000}
})

-- Delete
DB.delete('players', {
    where = {identifier = 'license:abc123'}
})

-- Count
local count = DB.count('players', {
    where = {money = {operator = ">", value = 5000}}
})
```

### Real-time Subscriptions

```lua
-- Subscribe to live data updates
local unsubscribe = DB.subscribe('players', {
    where = {online = true},
    orderBy = {money = 'desc'}
}, function(players)
    print("Players updated! Count:", #players)
    -- Convex automatically calls this when data changes
end)

-- Unsubscribe when done
unsubscribe()
```

## Production Features

### 1. Transactions (Anti-Duplication)

```lua
-- Atomic money transfer - all or nothing
local operations = {
    {type = "update", table = "players", where = {identifier = from}, data = {money = 400}},
    {type = "update", table = "players", where = {identifier = to}, data = {money = 600}},
}

exports['cfx-db']:executeTransaction(operations, function(success, results)
    if success then
        print("Transfer complete!")
    else
        print("Transfer failed! All operations rolled back.")
    end
end)
```

### 2. Query Caching

```lua
-- Configure in shared/config.lua
Config.Cache = {
    enabled = true,
    defaultTTL = 60000,      -- 60 seconds
    tableTTL = {
        players = 30000,     -- 30s
        vehicles = 60000,    -- 1min
    }
}

-- First query: 200ms (cache miss)
-- Second query: 5ms (cache hit - 97% faster!)
```

### 3. Audit Logging

```lua
-- All operations automatically logged
exports['cfx-db']:query('functions/audit:getRecentLogs', {
    limit = 50
}, function(success, logs)
    for _, log in ipairs(logs) do
        print(log.operation, log.table, log.resourceName)
    end
end)
```

### 4. Bulk Operations

```lua
-- Insert 100 records efficiently
local players = {}
for i = 1, 100 do
    table.insert(players, {
        identifier = 'license:test' .. i,
        name = 'Player ' .. i,
        money = 5000
    })
end

DB.insertMany('players', players, function(insertIds)
    print("Inserted", #insertIds, "players!")
end)
```

### 5. Snapshots (Backups)

```lua
-- Create snapshot
exports['cfx-db']:createSnapshot('pre_update_backup', function(success, result)
    if success then
        print("Backup created:", result.recordCount, "records")
    end
end)

-- Restore snapshot
exports['cfx-db']:restoreSnapshot('pre_update_backup', function(success, result)
    if success then
        print("Restored:", result.recordsRestored, "records")
    end
end)
```

### 6. Performance Monitoring

```lua
-- View performance stats
exports['cfx-db']:getPerformanceStats(function(stats)
    for _, metric in ipairs(stats) do
        print(metric.operation, metric.table, metric.avgTime, "ms")
    end
end)

-- Get slowest queries
exports['cfx-db']:getSlowestQueries(10, function(queries)
    -- Returns top 10 slowest queries
end)
```

### 7. Data Validation

```lua
-- Validation rules in convex/lib/validation_rules.ts
players: {
    identifier: [
        { type: "required" },
        { type: "string", pattern: "^(steam|license|discord):[a-fA-F0-9]+$" }
    ],
    money: [
        { type: "number", min: 0, integer: true }
    ]
}

-- Invalid data automatically rejected
DB.insert('players', {
    identifier = 'INVALID',  -- ❌ Fails validation
    name = 'Test'
}, function(insertId, err)
    print(err)  -- "Field 'identifier' does not match required pattern"
end)
```

### 8. Webhooks & Events

```lua
-- Subscribe to database events
exports['cfx-db']:subscribeToEvent('players:insert', function(event)
    print("New player:", event.data.name)

    -- Send to Discord, logging service, etc.
end)

-- Configure webhooks in shared/config.lua
Config.Webhooks = {
    {
        url = 'https://discord.com/api/webhooks/...',
        events = {'players:insert', 'players:delete'}
    }
}
```

### 9. Relationship Queries

```lua
-- Get player with their vehicles (JOIN-like)
DB.relations('players', {
    where = {identifier = license},
    relations = {
        {
            name = 'vehicles',
            table = 'vehicles',
            foreignKey = 'owner',
            localKey = 'identifier',
            type = 'many'
        }
    }
}, function(players)
    local player = players[1]
    print(player.name, "has", #player.vehicles, "vehicles")
end)
```

### 10. Migration System

```lua
-- Track schema versions
exports['cfx-db']:query('functions/migrations:getCurrentVersion', {}, function(success, version)
    print("Schema version:", version)
end)

-- Get migration history
exports['cfx-db']:query('functions/migrations:getAppliedMigrations', {}, function(success, migrations)
    for _, migration in ipairs(migrations) do
        print("v" .. migration.version, migration.name)
    end
end)
```

## Extending the Schema

Default schema is minimal. Add your own tables in `convex/schema.ts`:

```typescript
export default defineSchema({
    // Existing
    players: defineTable({...}),
    keyValue: defineTable({...}),

    // Add yours
    vehicles: defineTable({
        owner: v.string(),
        plate: v.string(),
        model: v.string(),
    }).index("by_owner", ["owner"]),
});
```

Then create functions in `convex/functions/`:

```typescript
// convex/functions/vehicles.ts
export const getPlayerVehicles = query({
    args: { owner: v.string() },
    handler: async (ctx, args) => {
        return ctx.db
            .query("vehicles")
            .withIndex("by_owner", (q) => q.eq("owner", args.owner))
            .collect();
    },
});
```

Use from FiveM:

```lua
local vehicles = exports['cfx-db']:queryAsync('vehicles:getPlayerVehicles', {
    owner = license
})
```

**Don't forget to add to whitelist** in `convex/lib/validators.ts`:

```typescript
const ALLOWED_TABLES = [
    "players",
    "keyValue",
    "vehicles",    // Add your table
];
```

## Configuration

Everything has sensible defaults. Override in `shared/config.lua`:

```lua
Config.Cache = {
    enabled = true,
    defaultTTL = 60000,
    maxSize = 1000,
    tableTTL = {
        players = 30000,
        vehicles = 60000,
    }
}

Config.RateLimit = {
    enabled = true,
    maxRequests = 100,
    interval = 60000,
}

Config.AccessControl = {
    enabled = true,
    defaultAccess = 'readwrite',
}

Config.Webhooks = {
    {
        url = 'https://discord.com/api/webhooks/...',
        events = {'players:insert', 'players:delete'},
    }
}
```

## How It Works

```
FiveM Server
    ↓ DB.insert/select/update/delete
CFX-DB (TypeScript)
    ↓ Query cache (LRU)
    ↓ Rate limiting
    ↓ Access control
    ↓ Audit logging
    ↓ Performance monitoring
Convex Cloud (real-time database)
    ↓ automatic sync on data changes
Your subscribe() callback gets called
```

**Convex handles all the real-time sync.** You just call `subscribe()` and it pushes updates automatically.

## Performance Features

- **Query Caching**: LRU cache with TTL (configurable per table)
- **Connection Pooling**: 5 HTTP clients, round-robin load balancing
- **Write Batching**: Mutations queued and flushed every 50ms
- **Subscription Deduplication**: Same query+args = 1 Convex subscription
- **Performance Monitoring**: Track slow queries (>1 second)
- **Bulk Operations**: Optimized batch inserts/updates/deletes

## Security Features

- **Table Whitelist**: Only allowed tables can be accessed
- **Input Validation**: Field-level constraints at database layer
- **Access Control**: Per-resource, per-table permissions
- **Rate Limiting**: Prevent database spam
- **Audit Logging**: Track who changed what, when
- **Transaction Safety**: Atomic operations prevent duplication exploits
- **Sanitization**: Automatic removal of protected fields

## Commands

```bash
bun run build              # Build TypeScript
bun run build:watch        # Watch mode
bun run convex:dev         # Convex dev mode (interactive setup)
bun run convex:deploy      # Deploy to production
```

## Migration from OxMySQL

```lua
-- Before (OxMySQL)
MySQL.Async.fetchAll('SELECT * FROM players WHERE identifier = @identifier', {
    ['@identifier'] = identifier
}, function(result)
    print(result[1].name)
end)

-- After (CFX-DB)
DB.select('players', {
    where = {identifier = identifier}
}, function(result)
    print(result[1].name)
end)
```

## Architecture

**What CFX-DB Does:**
- Simple CRUD API (like OxMySQL)
- Query caching with LRU eviction
- Transaction management
- Performance monitoring
- Audit logging
- Data validation
- Bulk operations
- Provides Lua/JS APIs

**What Convex Does:**
- Real-time data sync (automatically!)
- Serverless functions
- Automatic scaling
- Built-in auth
- Optimistic updates
- Conflict resolution

You get the best of both worlds.

## Troubleshooting

**"Could not resolve convex/server" error**
- This happens when using `bunx convex dev` directly
- **Fix:** Run `bun install` first, then use `bun run convex:dev` instead
- The npm script uses the locally installed convex package which resolves imports correctly

**"Access denied: table not allowed"**
- Add table to `ALLOWED_TABLES` in `convex/lib/validators.ts`

**Queries are slow (>500ms)**
- Add index in `convex/schema.ts`
- Enable caching in `shared/config.lua`
- Use `limit` and `select` to reduce result size

**Cache not working**
- Check `Config.Cache.enabled = true`
- Ensure queries are identical (same args)
- Check cache stats: `exports['cfx-db']:getCacheStats(function(stats) ... end)`

**Validation not working**
- Define rules in `convex/lib/validation_rules.ts`
- Deploy: `npx convex dev --once` (or `bun run convex:dev`)

## License

MIT - Use it however you want!

## Support

Questions? Issues? https://github.com/CFX-Software/cfx-db
