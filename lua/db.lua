--[[
    CFX-DB Simple CRUD API
    Makes Convex as easy as OxMySQL with real-time superpowers

    Features:
    - Simple API: DB.insert(), DB.select(), DB.update(), DB.delete()
    - SQL-like: DB.execute() for familiar syntax
    - Auto-async: Works with callbacks OR await automatically
    - Real-time: DB.subscribe() for live queries
    - Query Builder: DB.from('table').where().get()
]]

-- Use global Log (loaded from logger.lua via fxmanifest)
local log = Log.scoped("db")

DB = {}

-- Detect which cfx-db resource is running (dev: cfx-db-dev, prod: cfx-db)
local cfxDbResource = GetResourceState('cfx-db-dev') == 'started' and 'cfx-db-dev' or 'cfx-db'

-- ============================================
-- SIMPLE CRUD API
-- ============================================

---Insert a record into a table
---@param table string Table name
---@param data table Data to insert
---@param callback? function Optional callback (if not provided, returns Promise for await)
---@return any insertId or Promise
function DB.insert(table, data, callback)
    return executeOperation('insert', table, {data = data}, callback)
end

---Insert multiple records at once
---@param table string Table name
---@param records table[] Array of records to insert
---@param callback? function Optional callback
---@return any insertIds or Promise
function DB.insertMany(table, records, callback)
    if callback then
        exports[cfxDbResource]:_luaMutation('functions/crud:insertMany', {
            table = table,
            records = records
        }, function(success, result)
            if success then
                callback(result)
            else
                callback(nil, result)
            end
        end)
        return nil
    else
        local p = promise.new()
        exports[cfxDbResource]:_luaMutation('functions/crud:insertMany', {
            table = table,
            records = records
        }, function(success, result)
            if success then p:resolve(result)
            else p:reject(result) end
        end)
        return Citizen.Await(p)
    end
end

---Select records from a table
---@param table string Table name
---@param options? table Options: {where, orderBy, limit, offset, select}
---@param callback? function Optional callback
---@return any rows or Promise
function DB.select(table, options, callback)
    options = options or {}
    return executeOperation('select', table, options, callback)
end

---Select a single record (equivalent to select with limit 1)
---@param table string Table name
---@param options? table Options: {where, orderBy, select}
---@param callback? function Optional callback
---@return any row or Promise
function DB.selectOne(table, options, callback)
    options = options or {}
    options.limit = 1

    if callback then
        executeOperation('select', table, options, function(rows)
            callback(rows and rows[1] or nil)
        end)
        return nil
    else
        local rows = executeOperation('select', table, options)
        return rows and rows[1] or nil
    end
end

---Update records in a table
---@param table string Table name
---@param options table Options: {where, set}
---@param callback? function Optional callback
---@return any result or Promise
function DB.update(table, options, callback)
    return executeOperation('update', table, options, callback)
end

---Update multiple records with different values
---@param table string Table name
---@param updates table[] Array of {where, set} objects
---@param callback? function Optional callback
---@return any results or Promise
function DB.updateMany(table, updates, callback)
    if callback then
        exports[cfxDbResource]:_luaMutation('functions/crud:updateMany', {
            table = table,
            updates = updates
        }, function(success, result)
            if success then
                callback(result)
            else
                callback(nil, result)
            end
        end)
        return nil
    else
        local p = promise.new()
        exports[cfxDbResource]:_luaMutation('functions/crud:updateMany', {
            table = table,
            updates = updates
        }, function(success, result)
            if success then p:resolve(result)
            else p:reject(result) end
        end)
        return Citizen.Await(p)
    end
end

---Delete records from a table
---@param table string Table name
---@param options table Options: {where}
---@param callback? function Optional callback
---@return any result or Promise
function DB.delete(table, options, callback)
    return executeOperation('delete', table, options, callback)
end

---Count records in a table
---@param table string Table name
---@param options? table Options: {where}
---@param callback? function Optional callback
---@return any count or Promise
function DB.count(table, options, callback)
    options = options or {}
    return executeOperation('count', table, options, callback)
end

---Upsert: Insert if not exists, update if exists
---@param table string Table name
---@param options table Options: {where, insert, update}
---@param callback? function Optional callback
---@return any result or Promise
function DB.upsert(table, options, callback)
    if not options.where then
        error("upsert requires 'where' clause")
    end
    if not options.insert then
        error("upsert requires 'insert' data")
    end
    if not options.update then
        error("upsert requires 'update' data")
    end

    if callback then
        exports[cfxDbResource]:_luaMutation('functions/crud:execute', {
            operation = 'upsert',
            table = table,
            where = options.where,
            insert = options.insert,
            update = options.update
        }, function(success, result)
            if success then
                callback(result)
            else
                callback(nil, result)
            end
        end)
        return nil
    else
        local p = promise.new()
        exports[cfxDbResource]:_luaMutation('functions/crud:execute', {
            operation = 'upsert',
            table = table,
            where = options.where,
            insert = options.insert,
            update = options.update
        }, function(success, result)
            if success then p:resolve(result)
            else p:reject(result) end
        end)
        return Citizen.Await(p)
    end
end

-- ============================================
-- SQL-LIKE API
-- ============================================

---Execute SQL-like query
---@param sql string SQL query (SELECT, INSERT, UPDATE, DELETE)
---@param params? table Query parameters
---@param callback? function Optional callback
---@return any result or Promise
---@deprecated Use DB.insert(), DB.select(), DB.update(), DB.delete() instead
function DB.execute(sql, params, callback)
    log.warn("DB.execute() is deprecated and unreliable. Use DB.insert(), DB.select(), DB.update(), DB.delete() instead.")

    -- Parse SQL and convert to CRUD operation
    local parsed = parseSQL(sql, params)

    if parsed.operation == 'select' then
        return executeOperation('select', parsed.table, parsed.options, callback)
    elseif parsed.operation == 'insert' then
        return executeOperation('insert', parsed.table, {data = parsed.data}, callback)
    elseif parsed.operation == 'update' then
        return executeOperation('update', parsed.table, parsed.options, callback)
    elseif parsed.operation == 'delete' then
        return executeOperation('delete', parsed.table, parsed.options, callback)
    else
        error('Unsupported SQL operation: ' .. tostring(parsed.operation))
    end
end

---Execute scalar query (returns single value, like COUNT(*))
---@param sql string SQL query
---@param params? table Query parameters
---@param callback? function Optional callback
---@return any scalar value or Promise
---@deprecated Use DB.count() or DB.selectOne() instead
function DB.scalar(sql, params, callback)
    log.warn("DB.scalar() is deprecated. Use DB.count() or DB.selectOne() instead.")
    if callback then
        DB.execute(sql, params, function(result)
            if result and result[1] then
                -- Try to extract first value from first row
                local firstRow = result[1]
                for _, value in pairs(firstRow) do
                    callback(value)
                    return
                end
            end
            callback(nil)
        end)
        return nil
    else
        local result = DB.execute(sql, params)
        if result and result[1] then
            for _, value in pairs(result[1]) do
                return value
            end
        end
        return nil
    end
end

-- ============================================
-- QUERY BUILDER API
-- ============================================

---Create a query builder
---@param table string Table name
---@return QueryBuilder
function DB.from(table)
    return QueryBuilder.new(table)
end

-- ============================================
-- SUBSCRIPTIONS (Real-time queries)
-- ============================================

---Subscribe to real-time query updates
---@param table string Table name
---@param options table Options: {where, orderBy, limit, offset}
---@param callback function Callback fired when data changes
---@return function unsubscribe function
function DB.subscribe(table, options, callback)
    options = options or {}

    -- Build options object only with non-nil values
    local queryOptions = nil
    if options.orderBy or options.limit or options.offset or options.select then
        queryOptions = {}
        if options.orderBy then queryOptions.orderBy = options.orderBy end
        if options.limit then queryOptions.limit = options.limit end
        if options.offset then queryOptions.offset = options.offset end
        if options.select then queryOptions.select = options.select end
    end

    -- Build payload
    local payload = {
        operation = 'select',
        table = table,
    }
    if options.where then
        payload.where = options.where
    end
    if queryOptions then
        payload.options = queryOptions
    end

    local subId = exports[cfxDbResource]:_luaSubscribe('functions/crud:read', payload, callback)

    -- Return unsubscribe function
    return function()
        exports[cfxDbResource]:_luaUnsubscribe(subId)
    end
end

-- ============================================
-- CORE EXECUTION (Auto-detects callback/await)
-- ============================================

---Execute a CRUD operation
---@param operation string Operation type: insert, select, update, delete, count
---@param table string Table name
---@param options table Operation options
---@param callback? function Optional callback
---@return any result or Promise
function executeOperation(operation, table, options, callback)
    options = options or {}

    -- Build options object only with non-nil values
    -- This prevents empty table {} from being serialized as empty array []
    local queryOptions = nil
    if options.orderBy or options.limit or options.offset or options.select then
        queryOptions = {}
        if options.orderBy then queryOptions.orderBy = options.orderBy end
        if options.limit then queryOptions.limit = options.limit end
        if options.offset then queryOptions.offset = options.offset end
        if options.select then queryOptions.select = options.select end
    end

    -- Build the request payload
    local payload = {
        operation = operation,
        table = table,
    }

    -- Only add fields if they have values
    if options.data or options.set then
        payload.data = options.data or options.set
    end
    if options.where then
        payload.where = options.where
    end
    if queryOptions then
        payload.options = queryOptions
    end

    -- Read operations should use query endpoint for better performance.
    local isReadOperation = operation == 'select' or operation == 'count'

    -- If callback provided, use callback style
    if callback then
        if isReadOperation then
            exports[cfxDbResource]:_luaQuery('functions/crud:read', payload, function(success, result)
                if success then
                    callback(result)
                else
                    callback(nil, result)
                end
            end)
        else
            exports[cfxDbResource]:_luaMutation('functions/crud:execute', payload, function(success, result)
                if success then
                    callback(result)
                else
                    callback(nil, result)
                end
            end)
        end
        return nil
    else
        -- No callback = return Promise for Citizen.Await
        local p = promise.new()

        if isReadOperation then
            exports[cfxDbResource]:_luaQuery('functions/crud:read', payload, function(success, result)
                if success then
                    p:resolve(result)
                else
                    p:reject(result)
                end
            end)
        else
            exports[cfxDbResource]:_luaMutation('functions/crud:execute', payload, function(success, result)
                if success then
                    p:resolve(result)
                else
                    p:reject(result)
                end
            end)
        end

        return Citizen.Await(p)
    end
end

-- ============================================
-- SIMPLE SQL PARSER
-- ============================================

---Parse simple SQL queries into CRUD operations
---@param sql string SQL query
---@param params table[] Query parameters (? placeholders)
---@return table parsed {operation, table, options, data}
function parseSQL(sql, params)
    params = params or {}
    sql = sql:upper():gsub('%s+', ' '):trim()

    -- SELECT
    if sql:match('^SELECT') then
        local table = sql:match('FROM%s+([%w_]+)')
        local where = sql:match('WHERE%s+(.+)$')

        if not table then
            error('Could not parse table name from SQL')
        end

        return {
            operation = 'select',
            table = table:lower(),
            options = {
                where = where and parseWhere(where, params) or nil
            }
        }
    end

    -- INSERT
    if sql:match('^INSERT') then
        local table = sql:match('INTO%s+([%w_]+)')
        if not table then
            error('Could not parse table name from SQL')
        end

        -- Build data object from params
        local data = {}
        for i, value in ipairs(params) do
            data['field' .. i] = value
        end

        return {
            operation = 'insert',
            table = table:lower(),
            data = data
        }
    end

    -- UPDATE
    if sql:match('^UPDATE') then
        local table = sql:match('UPDATE%s+([%w_]+)')
        local where = sql:match('WHERE%s+(.+)$')

        if not table then
            error('Could not parse table name from SQL')
        end

        return {
            operation = 'update',
            table = table:lower(),
            options = {
                where = where and parseWhere(where, params) or {},
                set = {}  -- User will need to provide via params
            }
        }
    end

    -- DELETE
    if sql:match('^DELETE') then
        local table = sql:match('FROM%s+([%w_]+)')
        local where = sql:match('WHERE%s+(.+)$')

        if not table then
            error('Could not parse table name from SQL')
        end

        return {
            operation = 'delete',
            table = table:lower(),
            options = {
                where = where and parseWhere(where, params) or {}
            }
        }
    end

    error('Unsupported SQL query: ' .. sql)
end

---Parse WHERE clause (simplified)
---@param where string WHERE clause string
---@param params table[] Parameters
---@return table parsed where object
function parseWhere(where, params)
    -- Very simple parser - just handles single = comparisons
    local field = where:match('([%w_]+)%s*=%s*%?')

    if field and params[1] then
        return {
            [field:lower()] = params[1]
        }
    end

    return {}
end

-- Utility: String trim
function string:trim()
    return self:match('^%s*(.-)%s*$')
end

-- ============================================
-- EXPORTS (For other resources to use)
-- ============================================
-- Usage from other resources:
--   exports['cfx-db']:dbInsert('players', data, callback)
--   exports['cfx-db']:dbSelect('players', options, callback)

exports('dbInsert', function(table, data, callback)
    return DB.insert(table, data, callback)
end)

exports('dbInsertMany', function(table, records, callback)
    return DB.insertMany(table, records, callback)
end)

exports('dbSelect', function(table, options, callback)
    return DB.select(table, options, callback)
end)

exports('dbSelectOne', function(table, options, callback)
    return DB.selectOne(table, options, callback)
end)

exports('dbUpdate', function(table, options, callback)
    return DB.update(table, options, callback)
end)

exports('dbUpdateMany', function(table, updates, callback)
    return DB.updateMany(table, updates, callback)
end)

exports('dbDelete', function(table, options, callback)
    return DB.delete(table, options, callback)
end)

exports('dbCount', function(table, options, callback)
    return DB.count(table, options, callback)
end)

exports('dbUpsert', function(table, options, callback)
    return DB.upsert(table, options, callback)
end)

exports('dbExecute', function(sql, params, callback)
    return DB.execute(sql, params, callback)
end)

exports('dbSubscribe', function(table, options, callback)
    return DB.subscribe(table, options, callback)
end)

exports('dbFrom', function(table)
    return DB.from(table)
end)

-- NOTE: transaction() builder pattern doesn't work across FiveM resources
-- because FiveM strips metatables and functions from returned tables.
-- Use executeTransaction(operations, callback) instead - it's FiveM-safe.
-- The transaction builder (DB.transaction()) is only for use within cfx-db resource.

-- DB is available globally within cfx-db resource
