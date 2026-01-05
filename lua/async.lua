--[[
    Async Utilities for Lua
    Provides Promise-style utilities for working with callbacks
]]

---@class Promise
---@field resolve fun(value: any)
---@field reject fun(reason: any)

---Create a new promise
---@return Promise
function CreatePromise()
    return promise.new()
end

---Await a promise (blocks until resolved)
---@param p Promise
---@return any result
function AwaitPromise(p)
    return Citizen.Await(p)
end

---Convert callback-style function to promise
---@param fn function
---@param ... any arguments
---@return any result
function CallbackToPromise(fn, ...)
    local p = promise.new()
    local args = {...}

    -- Add callback as last argument
    table.insert(args, function(success, result)
        if success then
            p:resolve(result)
        else
            p:reject(result)
        end
    end)

    fn(table.unpack(args))

    return Citizen.Await(p)
end
