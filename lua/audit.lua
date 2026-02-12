--[[
    Audit Log Query API for CFX-DB

    Provides Lua functions for querying audit logs for anti-cheat,
    debugging, and compliance analysis.
]]

local Audit = {}

-- Detect which cfx-db resource is running (dev: cfx-db-dev, prod: cfx-db)
local cfxDbResource = GetResourceState('cfx-db-dev') == 'started' and 'cfx-db-dev' or 'cfx-db'

---Query audit logs with filters
---@param filters table Query filters (table, operation, resourceName, playerId, startTime, endTime, limit, successOnly)
---@param callback function Callback function(success, logs)
function Audit.query(filters, callback)
    if type(filters) ~= "table" then
        error("Audit.query: filters must be a table")
    end

    if type(callback) ~= "function" then
        error("Audit.query: callback must be a function")
    end

    exports[cfxDbResource]:query('functions/audit:queryLogs', filters, callback)
end

---Query audit logs by table
---@param tableName string Table name to query logs for
---@param limit number|nil Maximum number of logs to return (default: 100)
---@param callback function Callback function(success, logs)
function Audit.byTable(tableName, limit, callback)
    if type(tableName) ~= "string" then
        error("Audit.byTable: tableName must be a string")
    end

    -- Handle optional limit parameter
    if type(limit) == "function" then
        callback = limit
        limit = nil
    end

    if type(callback) ~= "function" then
        error("Audit.byTable: callback must be a function")
    end

    exports[cfxDbResource]:query('functions/audit:queryByTable', {
        table = tableName,
        limit = limit
    }, callback)
end

---Query audit logs by resource
---@param resourceName string Resource name to query logs for
---@param limit number|nil Maximum number of logs to return (default: 100)
---@param callback function Callback function(success, logs)
function Audit.byResource(resourceName, limit, callback)
    if type(resourceName) ~= "string" then
        error("Audit.byResource: resourceName must be a string")
    end

    -- Handle optional limit parameter
    if type(limit) == "function" then
        callback = limit
        limit = nil
    end

    if type(callback) ~= "function" then
        error("Audit.byResource: callback must be a function")
    end

    exports[cfxDbResource]:query('functions/audit:queryByResource', {
        resourceName = resourceName,
        limit = limit
    }, callback)
end

---Query audit logs by player
---@param playerId string Player identifier to query logs for
---@param limit number|nil Maximum number of logs to return (default: 100)
---@param callback function Callback function(success, logs)
function Audit.byPlayer(playerId, limit, callback)
    if type(playerId) ~= "string" then
        error("Audit.byPlayer: playerId must be a string")
    end

    -- Handle optional limit parameter
    if type(limit) == "function" then
        callback = limit
        limit = nil
    end

    if type(callback) ~= "function" then
        error("Audit.byPlayer: callback must be a function")
    end

    exports[cfxDbResource]:query('functions/audit:queryByPlayer', {
        playerId = playerId,
        limit = limit
    }, callback)
end

---Query audit logs by operation type
---@param operation string Operation type (insert, update, delete, select, count)
---@param limit number|nil Maximum number of logs to return (default: 100)
---@param callback function Callback function(success, logs)
function Audit.byOperation(operation, limit, callback)
    if type(operation) ~= "string" then
        error("Audit.byOperation: operation must be a string")
    end

    -- Handle optional limit parameter
    if type(limit) == "function" then
        callback = limit
        limit = nil
    end

    if type(callback) ~= "function" then
        error("Audit.byOperation: callback must be a function")
    end

    exports[cfxDbResource]:query('functions/audit:queryByOperation', {
        operation = operation,
        limit = limit
    }, callback)
end

---Get recent audit logs
---@param limit number|nil Maximum number of logs to return (default: 100)
---@param callback function Callback function(success, logs)
function Audit.recent(limit, callback)
    -- Handle optional limit parameter
    if type(limit) == "function" then
        callback = limit
        limit = nil
    end

    if type(callback) ~= "function" then
        error("Audit.recent: callback must be a function")
    end

    exports[cfxDbResource]:query('functions/audit:getRecentLogs', {
        limit = limit
    }, callback)
end

---Get failed operations
---@param limit number|nil Maximum number of logs to return (default: 100)
---@param callback function Callback function(success, logs)
function Audit.failed(limit, callback)
    -- Handle optional limit parameter
    if type(limit) == "function" then
        callback = limit
        limit = nil
    end

    if type(callback) ~= "function" then
        error("Audit.failed: callback must be a function")
    end

    exports[cfxDbResource]:query('functions/audit:getFailedOperations', {
        limit = limit
    }, callback)
end

---Get audit statistics
---@param startTime number|nil Unix timestamp to start from (optional)
---@param endTime number|nil Unix timestamp to end at (optional)
---@param callback function Callback function(success, stats)
function Audit.stats(startTime, endTime, callback)
    -- Handle optional parameters
    if type(startTime) == "function" then
        callback = startTime
        startTime = nil
        endTime = nil
    elseif type(endTime) == "function" then
        callback = endTime
        endTime = nil
    end

    if type(callback) ~= "function" then
        error("Audit.stats: callback must be a function")
    end

    exports[cfxDbResource]:query('functions/audit:getStatistics', {
        startTime = startTime,
        endTime = endTime
    }, callback)
end

-- Expose audit API
_G.DBAudit = Audit

-- Also add to main DB namespace
if DB then
    DB.audit = Audit
end

return Audit
