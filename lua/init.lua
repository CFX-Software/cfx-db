--[[
    CFX-DB Lua Initialization
    Sets up the Lua environment
]]

print("^2[cfx-db]^7 Lua API loaded")

-- DB global is available from lua/db.lua

-- Wait for framework to be ready
Citizen.CreateThread(function()
    local attempts = 0
    local maxAttempts = 30  -- 30 seconds max wait

    while attempts < maxAttempts do
        attempts = attempts + 1
        Citizen.Wait(1000)

        local success, stats = pcall(function()
            return exports[GetCurrentResourceName()]:getStats()
        end)

        if success and stats and stats.connection and stats.connection.healthy then
            print("^2[cfx-db]^7 ✓ Lua API ready!")
            return
        end
    end

    print("^1[cfx-db]^7 ✗ Failed to connect after 30 seconds")
    print("^3[cfx-db]^7 Check your .env file and Convex deployment")
end)
