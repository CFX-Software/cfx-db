--[[
    CFX-DB Lua Initialization
    Sets up the Lua environment with reconnection support
]]

print("^2[cfx-db]^7 Lua API loaded")

-- DB global is available from lua/db.lua

-- Track connection state
local connectionReady = false
local reconnectionCount = 0

-- Forward declaration for local function
local StartConnectionMonitor

-- Wait for initial framework connection
Citizen.CreateThread(function()
    local attempts = 0
    local maxInitialAttempts = 30  -- 30 seconds for initial connection

    while attempts < maxInitialAttempts do
        attempts = attempts + 1
        Citizen.Wait(1000)

        local success, stats = pcall(function()
            return exports[GetCurrentResourceName()]:getStats()
        end)

        if success and stats and stats.connection then
            if stats.connection.healthy then
                print("^2[cfx-db]^7 ✓ Lua API ready!")
                connectionReady = true
                StartConnectionMonitor() -- Start monitor even when healthy for disconnect detection
                return
            elseif stats.connection.reconnecting then
                -- Show reconnection status
                print(string.format("^3[cfx-db]^7 Reconnecting... (attempt %d)", stats.connection.reconnectAttempts or 0))
            elseif stats.connection.initialized then
                -- Initialized but not healthy - health check in progress
                print("^3[cfx-db]^7 Waiting for health check...")
            end
        end
    end

    -- Still not connected after initial timeout - start monitoring
    print("^3[cfx-db]^7 Initial connection timed out, starting background monitor...")
    print("^3[cfx-db]^7 Check your .env file and Convex deployment")

    -- Continue monitoring in background
    StartConnectionMonitor()
end)

-- Background connection monitor (local function)
StartConnectionMonitor = function()
    Citizen.CreateThread(function()
        while true do
            Citizen.Wait(5000)  -- Check every 5 seconds

            local success, stats = pcall(function()
                return exports[GetCurrentResourceName()]:getStats()
            end)

            if success and stats and stats.connection then
                if stats.connection.healthy and not connectionReady then
                    connectionReady = true
                    reconnectionCount = reconnectionCount + 1
                    if reconnectionCount == 1 then
                        print("^2[cfx-db]^7 ✓ Connection established!")
                    else
                        print(string.format("^2[cfx-db]^7 ✓ Reconnected! (reconnection #%d)", reconnectionCount))
                    end
                    TriggerEvent("cfxdb:lua:ready")
                elseif not stats.connection.healthy and connectionReady then
                    connectionReady = false
                    print("^1[cfx-db]^7 ✗ Connection lost, attempting to reconnect...")
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
        print(string.format("^2[cfx-db]^7 ✓ Reconnected! (reconnection #%d)", reconnectionCount))
        TriggerEvent("cfxdb:lua:ready")
    end
end)

-- Export connection status helpers
exports("isConnectionReady", function()
    return connectionReady
end)

exports("getConnectionStatus", function()
    local success, stats = pcall(function()
        return exports[GetCurrentResourceName()]:getStats()
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
