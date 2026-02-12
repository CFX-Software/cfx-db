fx_version 'cerulean'
game 'gta5'

name 'cfx-db'
author 'CFX Software'
description 'Simple Convex database integration for FiveM'
version '1.1.1'
repository 'https://github.com/CFX-Software/cfx-db'

-- Use Node.js 22
node_version '22'

-- Disable FiveM auto-build (dependencies installed manually with Bun)
disable_build_task 'yarn'

-- No dependencies - run `bun install` manually before starting

-- Server scripts (TypeScript compiled to JS)
server_scripts {
    'dist/server/main.js',
}

-- Lua API (server-side)
server_scripts {
    'lua/logger.lua',  -- Must load first (other modules depend on it)
    'lua/init.lua',
    'lua/async.lua',
    'lua/api.lua',
    'lua/db.lua',
    'lua/query-builder.lua',
    'lua/audit.lua',
    'lua/transaction.lua',
    'lua/relations.lua',
    'lua/events.lua',
}

-- Client scripts (minimal)
client_scripts {
    'client/main.lua',
}

-- Shared
shared_scripts {
    'shared/config.lua',
}

-- Lua exports (server-side)
server_exports {
    -- Core API
    'query',
    'queryAsync',
    'mutation',
    'mutationSync',
    'subscribe',
    'unsubscribe',
    'queryRaw',
    'mutationRaw',

    -- Unified CRUD API (JS + Lua parity)
    'insert',
    'insertMany',
    'select',
    'selectOne',
    'update',
    'updateMany',
    'delete',
    'count',
    'upsert',
    'watch',
    'relations',
    'relationsCount',
    'transaction',

    -- Legacy Lua-style compatibility exports
    'dbInsert',
    'dbInsertMany',
    'dbSelect',
    'dbSelectOne',
    'dbUpdate',
    'dbUpdateMany',
    'dbDelete',
    'dbCount',
    'dbUpsert',
    'dbExecute',
    'dbSubscribe',
    'dbFrom',
    'counterIncrement',
    'counterDecrement',
    'counterAdd',
    'counterGet',
    'counterGetSync',
    'counterGetMany',

    -- Cache / performance
    'getCached',
    'setCached',
    'invalidateCache',
    'getCoalescingStats',
    'resetCoalescingStats',
    'getPerformanceStats',
    'getSlowestQueries',
    'getAllSlowQueries',
    'resetPerformanceMetrics',
    'getCacheStats',
    'clearCache',
    'invalidateTableCache',
    'configureCache',

    -- Events / webhooks / snapshots
    'configureWebhooks',
    'getWebhookStats',
    'getEventStats',
    'clearEventListeners',
    'subscribeToEvent',
    'unsubscribeFromEvent',
    'createSnapshot',
    'restoreSnapshot',
    'listSnapshots',
    'deleteSnapshot',
    'getSnapshotStats',
    'executeTransaction',

    -- Advanced health/version/updater
    'getConvexClient',
    'getConvexHttpClient',
    'getStats',
    'forceReconnect',
    'isHealthy',
    'isReady',
    'getVersion',
    'getVersionStatus',
    'checkForUpdates',
    'applyUpdate',

    -- Optional helpers (for syncing to clients)
    'sendToPlayers',
    'setGlobalState',
    'setPlayerState',
}

-- Client exports
client_exports {
    'getClientData',
    'onServerData',
}
