--[[
    CFX-DB Client

    Most data should stay server-side.
    If you need client-side data, use events or statebags from your own resources.
]]

print("^2[cfx-db]^7 Client ready (most logic is server-side)")

-- Simple helper if users want to listen for data
local clientData = {}

---Get client-side data (if your server sends it)
---@param key string
---@return any|nil
function GetClientData(key)
    return clientData[key]
end

---Listen for data from server
---@param eventName string
---@param callback fun(data: any)
function OnServerData(eventName, callback)
    RegisterNetEvent(eventName, function(data)
        clientData[eventName] = data
        callback(data)
    end)
end

-- Export helpers
exports('getClientData', GetClientData)
exports('onServerData', OnServerData)
