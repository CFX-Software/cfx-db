--[[
    Relationship Query API for CFX-DB

    Provides JOIN-like functionality to query related data across tables.

    Example usage:
        DB.relations('players', {
            where = {identifier = license},
            relations = {
                {
                    name = 'vehicles',
                    table = 'vehicles',
                    foreignKey = 'owner',
                    localKey = 'identifier',
                    type = 'many'
                },
                {
                    name = 'inventory',
                    table = 'inventory',
                    foreignKey = 'owner',
                    localKey = 'identifier',
                    type = 'many',
                    select = {'item', 'count'}
                }
            }
        }, function(success, players)
            if success then
                local player = players[1]
                print("Player has", #player.vehicles, "vehicles")
                print("Player has", #player.inventory, "items")
            end
        end)
]]

local Relations = {}

-- Detect which cfx-db resource is running (dev: cfx-db-dev, prod: cfx-db)
local cfxDbResource = GetResourceState('cfx-db-dev') == 'started' and 'cfx-db-dev' or 'cfx-db'

---Query with relations (JOIN-like)
---@param table string Primary table name
---@param params table Query parameters {where, options, relations}
---@param callback function Callback function(success, records)
function Relations.query(table, params, callback)
    if type(table) ~= "string" then
        error("Relations.query: table must be a string")
    end

    if type(params) ~= "table" then
        error("Relations.query: params must be a table")
    end

    if type(callback) ~= "function" then
        error("Relations.query: callback must be a function")
    end

    if not params.relations or type(params.relations) ~= "table" then
        error("Relations.query: params.relations must be a table")
    end

    -- Validate relations
    for i, relation in ipairs(params.relations) do
        if not relation.name then
            error(string.format("Relations.query: relation %d missing 'name' field", i))
        end

        if not relation.table then
            error(string.format("Relations.query: relation %d missing 'table' field", i))
        end

        if not relation.foreignKey then
            error(string.format("Relations.query: relation %d missing 'foreignKey' field", i))
        end

        if not relation.type or (relation.type ~= "one" and relation.type ~= "many") then
            error(string.format("Relations.query: relation %d 'type' must be 'one' or 'many'", i))
        end
    end

    local args = {
        table = table,
        where = params.where,
        options = params.options,
        relations = params.relations
    }

    exports[cfxDbResource]:query('relations.queryWithRelations', args, callback)
end

---Query with relations (async/await style)
---@param table string Primary table name
---@param params table Query parameters {where, options, relations}
---@return boolean success
---@return any records
function Relations.queryAsync(table, params)
    if type(table) ~= "string" then
        error("Relations.queryAsync: table must be a string")
    end

    if type(params) ~= "table" then
        error("Relations.queryAsync: params must be a table")
    end

    if not params.relations or type(params.relations) ~= "table" then
        error("Relations.queryAsync: params.relations must be a table")
    end

    local args = {
        table = table,
        where = params.where,
        options = params.options,
        relations = params.relations
    }

    local success, result = exports[cfxDbResource]:queryAsync('relations.queryWithRelations', args)
    return success, result
end

---Count related records
---@param table string Primary table name
---@param params table Query parameters {where, relation}
---@param callback function Callback function(success, counts)
function Relations.count(table, params, callback)
    if type(table) ~= "string" then
        error("Relations.count: table must be a string")
    end

    if type(params) ~= "table" then
        error("Relations.count: params must be a table")
    end

    if type(callback) ~= "function" then
        error("Relations.count: callback must be a function")
    end

    if not params.relation or type(params.relation) ~= "table" then
        error("Relations.count: params.relation must be a table")
    end

    local args = {
        table = table,
        where = params.where,
        relation = params.relation
    }

    exports[cfxDbResource]:query('relations.countWithRelations', args, callback)
end

-- Helper: Simple one-to-many query
---Fetch primary record with related records
---@param primaryTable string Primary table name
---@param primaryWhere table Where clause for primary table
---@param relationName string Name for the relation in results
---@param relationTable string Related table name
---@param foreignKey string Foreign key in related table
---@param localKey string|nil Local key in primary table (default: identifier or _id)
---@param callback function Callback function(success, record)
function Relations.oneToMany(primaryTable, primaryWhere, relationName, relationTable, foreignKey, localKey, callback)
    -- Handle optional localKey parameter
    if type(localKey) == "function" then
        callback = localKey
        localKey = nil
    end

    Relations.query(primaryTable, {
        where = primaryWhere,
        relations = {
            {
                name = relationName,
                table = relationTable,
                foreignKey = foreignKey,
                localKey = localKey,
                type = "many"
            }
        }
    }, function(success, records)
        if success and records and #records > 0 then
            callback(true, records[1])
        else
            callback(success, records)
        end
    end)
end

-- Helper: Simple one-to-one query
---Fetch primary record with a single related record
---@param primaryTable string Primary table name
---@param primaryWhere table Where clause for primary table
---@param relationName string Name for the relation in results
---@param relationTable string Related table name
---@param foreignKey string Foreign key in related table
---@param localKey string|nil Local key in primary table
---@param callback function Callback function(success, record)
function Relations.oneToOne(primaryTable, primaryWhere, relationName, relationTable, foreignKey, localKey, callback)
    -- Handle optional localKey parameter
    if type(localKey) == "function" then
        callback = localKey
        localKey = nil
    end

    Relations.query(primaryTable, {
        where = primaryWhere,
        relations = {
            {
                name = relationName,
                table = relationTable,
                foreignKey = foreignKey,
                localKey = localKey,
                type = "one"
            }
        }
    }, function(success, records)
        if success and records and #records > 0 then
            callback(true, records[1])
        else
            callback(success, records)
        end
    end)
end

-- Expose relations API
_G.DBRelations = Relations

-- Add to main DB namespace
if DB then
    DB.relations = Relations.query
    DB.relationsAsync = Relations.queryAsync
    DB.relationsCount = Relations.count
    DB.oneToMany = Relations.oneToMany
    DB.oneToOne = Relations.oneToOne
end

return Relations
