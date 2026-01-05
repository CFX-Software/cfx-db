--[[
    CFX-DB Shared Configuration
    Config values shared between client and server
]]

Config = {}

-- Resource name
Config.ResourceName = 'cfx-db'

-- Version
Config.Version = '1.0.0'

-- Debug mode
Config.Debug = false

-- Table Permissions (Access Control)
-- Control which resources can read/write to which tables
-- Default: All resources can access all tables (if not specified)
-- Format: ['table_name'] = { read = {'resource1', 'resource2'}, write = {'resource1'} }
-- Use '*' to allow all resources
Config.TablePermissions = {
    -- Example: Lock down sensitive tables
    -- ['admin_logs'] = {
    --     read = {'admin_panel'},      -- Only admin_panel can read
    --     write = {'admin_panel'}       -- Only admin_panel can write
    -- },

    -- Example: Public read, restricted write
    -- ['players'] = {
    --     read = {'*'},                 -- All resources can read
    --     write = {'es_extended', 'qb-core', 'cfx-db'}  -- Only these can write
    -- },
}

-- Webhooks Configuration
-- Configure external webhooks to receive database events
-- Format: { url, events, headers (optional), retryOnFailure (optional), maxRetries (optional) }
Config.Webhooks = {
    -- Example: Discord webhook for player inserts/deletes
    -- {
    --     url = 'https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN',
    --     events = {'players:insert', 'players:delete'},
    --     retryOnFailure = true,
    --     maxRetries = 3
    -- },

    -- Example: Custom API webhook for all player events
    -- {
    --     url = 'https://your-api.com/webhooks/cfx-db',
    --     events = {'players:*'},
    --     headers = {
    --         ['Authorization'] = 'Bearer YOUR_API_TOKEN',
    --         ['X-Custom-Header'] = 'value'
    --     }
    -- },

    -- Example: Global webhook for all events
    -- {
    --     url = 'https://monitoring.example.com/events',
    --     events = {'*'}
    -- },
}

-- Cache Configuration
Config.Cache = {
    enabled = true,
    defaultTTL = 60000,      -- 60 seconds
    maxSize = 1000,          -- Maximum cache entries
    tableTTL = {
        players = 30000,     -- 30s (changes frequently)
        keyValue = 120000,   -- 2min (rarely changes)
    }
}

return Config
