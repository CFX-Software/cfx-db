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

-- ============================================
-- SHARDED COUNTERS
-- High-throughput counters for stats like online players, total money, etc.
-- ============================================

---Increment a counter by 1
---@param name string Counter name (e.g., "onlinePlayers", "totalMoney")
---@param callback? function Optional callback
function CounterIncrement(name, callback)
    Mutation('lib/counters:increment', { name = name }, callback, "high")
end

---Decrement a counter by 1
---@param name string Counter name
---@param callback? function Optional callback
function CounterDecrement(name, callback)
    Mutation('lib/counters:decrement', { name = name }, callback, "high")
end

---Add a value to a counter (can be negative)
---@param name string Counter name
---@param value number Value to add
---@param callback? function Optional callback
function CounterAdd(name, value, callback)
    Mutation('lib/counters:add', { name = name, value = value }, callback, "high")
end

---Get the current value of a counter
---@param name string Counter name
---@param callback? function Callback with (success, value)
function CounterGet(name, callback)
    Query('lib/counters:get', { name = name }, callback)
end

---Get a counter value synchronously
---@param name string Counter name
---@return number value
function CounterGetSync(name)
    return QueryAsync('lib/counters:get', { name = name })
end

---Get multiple counter values at once
---@param names table Array of counter names
---@param callback? function Callback with (success, {name: value, ...})
function CounterGetMany(names, callback)
    Query('lib/counters:getMany', { names = names }, callback)
end

-- Export Lua-specific functions only
-- (The JS side exports: query, mutation, subscribe, getCached, setCached, invalidateCache, getStats, etc.)
exports('queryAsync', QueryAsync)
exports('mutationSync', MutationSync)

-- Counter exports
exports('counterIncrement', CounterIncrement)
exports('counterDecrement', CounterDecrement)
exports('counterAdd', CounterAdd)
exports('counterGet', CounterGet)
exports('counterGetSync', CounterGetSync)
exports('counterGetMany', CounterGetMany)
