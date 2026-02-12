--[[
    CFX-DB Shared Configuration
    Config values shared between client and server
]]

Config = {}

-- Resource name
Config.ResourceName = 'cfx-db'

-- Version
Config.Version = '1.1.1'

-- Debug mode (deprecated - use LogLevel instead)
Config.Debug = false

-- Logging Configuration
-- Log levels: 'debug' | 'info' | 'warn' | 'error'
-- debug: All logs including health checks, stats, verbose diagnostics
-- info: Important state changes, startup/shutdown (production default)
-- warn: Warnings and recoverable issues
-- error: Critical failures only
Config.LogLevel = 'info'

-- Structured JSON output for log aggregation (Datadog, Splunk, etc.)
-- When true, logs are output as JSON objects instead of human-readable text
Config.LogStructured = false

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
    }
}

-- Auto-Updater Configuration (production-safe defaults)
-- Requires this resource to be a git checkout with a reachable remote.
-- By default this only checks and notifies; it will not auto-apply updates.
Config.AutoUpdater = {
    enabled = false,             -- Master switch for scheduled checks
    mode = 'notify',             -- 'notify' | 'patch' | 'minor' | 'major'
    versionSource = 'hybrid',    -- 'github' | 'git' | 'hybrid' (github first, git fallback)
    checkIntervalMinutes = 30,   -- Scheduled check interval
    remote = 'origin',           -- Git remote to fetch/pull from
    branch = 'main',             -- Branch used for ff-only pull
    restartOnUpdate = false,     -- Issue restart command automatically after update
    requireCleanWorkTree = true, -- Block update if local files changed
    fetchTags = true,            -- Fetch tags before version check
    includePrerelease = false,   -- Include prerelease entries from GitHub releases
    notifyOnUpToDate = true,     -- Emits UP_TO_DATE/OUTDATED status lines each check
    githubReleasesApiUrl = 'https://api.github.com/repos/CFX-Software/cfx-db/releases',
    commandTimeoutMs = 10000,    -- Git command timeout
}

return Config
