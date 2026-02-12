--[[
    CFX-DB Lua Initialization
    Sets up the Lua environment with reconnection support
]]

-- Use global Log (loaded from logger.lua via fxmanifest)
local log = Log.scoped("init")

log.debug("Lua bridge initialized")

-- DB global is available from lua/db.lua

-- Track connection state
local connectionReady = false
local reconnectionCount = 0

-- Forward declaration for local function
local StartConnectionMonitor

-- Detect which cfx-db resource is running (dev: cfx-db-dev, prod: cfx-db)
local cfxDbResource = GetResourceState('cfx-db-dev') == 'started' and 'cfx-db-dev' or 'cfx-db'

-- Listen for TypeScript framework ready event (primary method)
AddEventHandler("cfxdb:ready", function()
    if not connectionReady then
        connectionReady = true
        reconnectionCount = 1
        log.info("Lua bridge ready")
        StartConnectionMonitor()
        TriggerEvent("cfxdb:lua:ready")
    end
end)

-- Background connection monitor (local function)
StartConnectionMonitor = function()
    Citizen.CreateThread(function()
        while true do
            Citizen.Wait(5000)  -- Check every 5 seconds

            local success, stats = pcall(function()
                return exports[cfxDbResource]:getStats()
            end)

            if success and stats and stats.connection then
                if stats.connection.healthy and not connectionReady then
                    connectionReady = true
                    reconnectionCount = reconnectionCount + 1
                    if reconnectionCount == 1 then
                        log.info("Connection established")
                    else
                        log.info("Reconnected", { count = reconnectionCount })
                    end
                    TriggerEvent("cfxdb:lua:ready")
                elseif not stats.connection.healthy and connectionReady then
                    connectionReady = false
                    log.warn("Connection lost, attempting to reconnect")
                    TriggerEvent("cfxdb:lua:disconnected")
                end
            end
        end
    end)
end

-- Listen for TypeScript reconnection events
AddEventHandler("cfxdb:reconnected", function()
    if not connectionReady then
        connectionReady = true
        reconnectionCount = reconnectionCount + 1
        log.info("Reconnected", { count = reconnectionCount })
        TriggerEvent("cfxdb:lua:ready")
    end
end)

-- Export connection status helpers
exports("isConnectionReady", function()
    return connectionReady
end)

exports("getConnectionStatus", function()
    local success, stats = pcall(function()
        return exports[cfxDbResource]:getStats()
    end)

    if success and stats and stats.connection then
        return {
            ready = connectionReady,
            healthy = stats.connection.healthy,
            reconnecting = stats.connection.reconnecting,
            reconnectAttempts = stats.connection.reconnectAttempts,
            reconnectionCount = reconnectionCount
        }
    end

    return {
        ready = false,
        healthy = false,
        reconnecting = false,
        reconnectAttempts = 0,
        reconnectionCount = reconnectionCount
    }
end)

-- Note: forceReconnect export is provided directly by TypeScript
-- No Lua wrapper needed - it doesn't return a promise
