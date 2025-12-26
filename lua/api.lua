--[[
    CFX-DB Lua API
    User-friendly Lua exports for working with Convex
]]

local resourceName = GetCurrentResourceName()

---Execute a query with callback
---@param queryName string The Convex query name (e.g., "players:get")
---@param args table Arguments for the query
---@param callback fun(success: boolean, result: any)
function Query(queryName, args, callback)
    exports[resourceName]:_luaQuery(queryName, args, callback)
end

---Execute a query synchronously (uses Citizen.Await)
---@param queryName string
---@param args table
---@return any result
function QueryAsync(queryName, args)
    local p = promise.new()

    exports[resourceName]:_luaQuery(queryName, args, function(success, result)
        if success then
            p:resolve(result)
        else
            p:reject(result)
        end
    end)

    return Citizen.Await(p)
end

---Execute a mutation with callback
---@param mutationName string The Convex mutation name (e.g., "players:upsertOnJoin")
---@param args table Arguments for the mutation
---@param callback fun(success: boolean, result: any)|nil Optional callback
---@param priority string|nil "high", "normal", or "low" (default: "normal")
function Mutation(mutationName, args, callback, priority)
    callback = callback or function() end
    exports[resourceName]:_luaMutation(mutationName, args, callback, priority)
end

---Execute a mutation synchronously (uses Citizen.Await)
---@param mutationName string
---@param args table
---@param priority string|nil
---@return any result
function MutationSync(mutationName, args, priority)
    local p = promise.new()

    exports[resourceName]:_luaMutation(mutationName, args, function(success, result)
        if success then
            p:resolve(result)
        else
            p:reject(result)
        end
    end, priority)

    return Citizen.Await(p)
end

---Subscribe to real-time query updates
---@param queryName string
---@param args table
---@param callback fun(data: any) Called whenever data updates
---@return string subscriptionId Use this to unsubscribe later
function Subscribe(queryName, args, callback)
    return exports[resourceName]:_luaSubscribe(queryName, args, callback)
end

---Unsubscribe from updates
---@param subscriptionId string
---@return boolean success
function Unsubscribe(subscriptionId)
    return exports[resourceName]:_luaUnsubscribe(subscriptionId)
end

-- Export Lua-specific functions only
-- (The JS side exports: query, mutation, subscribe, getCached, setCached, invalidateCache, getStats, etc.)
exports('queryAsync', QueryAsync)
exports('mutationSync', MutationSync)
