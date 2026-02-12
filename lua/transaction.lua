--[[
    Transaction Builder for CFX-DB

    Provides a fluent API for building atomic transactions.
    All operations in a transaction succeed or fail together.

    NOTE: Methods are attached directly to each instance (not via metatable)
    because FiveM strips metatables when tables cross resource boundaries.

    Example usage:
        local tx = exports['cfx-db']:transaction()
            :update('players', {where = {identifier = license}, set = {money = money - 100}})
            :update('players', {where = {identifier = target}, set = {money = money + 100}})
            :insert('transactions', {from = license, to = target, amount = 100, time = os.time()})
            :commit(function(success, result)
                if success then
                    print("Transaction committed!")
                else
                    print("Transaction failed:", result)
                end
            end)
]]

-- Detect which cfx-db resource is running (dev: cfx-db-dev, prod: cfx-db)
local cfxDbResource = GetResourceState('cfx-db-dev') == 'started' and 'cfx-db-dev' or 'cfx-db'
local log = Log.scoped("transaction")

---Create a new transaction instance with methods directly attached
---@return table Transaction instance
local function create()
    local tx = {
        operations = {}
    }

    ---Add an INSERT operation
    ---@param tableName string Table name
    ---@param data table Data to insert
    ---@return table self for chaining
    function tx:insert(tableName, data)
        if type(tableName) ~= "string" then
            error("Transaction:insert() - tableName must be a string")
        end
        if type(data) ~= "table" then
            error("Transaction:insert() - data must be a table")
        end

        table.insert(self.operations, {
            type = "insert",
            table = tableName,
            data = data
        })
        return self
    end

    ---Add an UPDATE operation
    ---@param tableName string Table name
    ---@param params table {where = {...}, set = {...}}
    ---@return table self for chaining
    function tx:update(tableName, params)
        if type(tableName) ~= "string" then
            error("Transaction:update() - tableName must be a string")
        end
        if type(params) ~= "table" then
            error("Transaction:update() - params must be a table")
        end
        if not params.where then
            error("Transaction:update() - params.where is required")
        end
        if not params.set then
            error("Transaction:update() - params.set is required")
        end

        table.insert(self.operations, {
            type = "update",
            table = tableName,
            where = params.where,
            data = params.set
        })
        return self
    end

    ---Add a DELETE operation
    ---@param tableName string Table name
    ---@param where table Where clause
    ---@return table self for chaining
    function tx:delete(tableName, where)
        if type(tableName) ~= "string" then
            error("Transaction:delete() - tableName must be a string")
        end
        if type(where) ~= "table" then
            error("Transaction:delete() - where must be a table")
        end

        table.insert(self.operations, {
            type = "delete",
            table = tableName,
            where = where
        })
        return self
    end

    ---Add an UPSERT operation
    ---@param tableName string Table name
    ---@param params table {where = {...}, insert = {...}, update = {...}}
    ---@return table self for chaining
    function tx:upsert(tableName, params)
        if type(tableName) ~= "string" then
            error("Transaction:upsert() - tableName must be a string")
        end
        if type(params) ~= "table" then
            error("Transaction:upsert() - params must be a table")
        end
        if not params.where then
            error("Transaction:upsert() - params.where is required")
        end
        if not params.insert then
            error("Transaction:upsert() - params.insert is required")
        end
        if not params.update then
            error("Transaction:upsert() - params.update is required")
        end

        table.insert(self.operations, {
            type = "upsert",
            table = tableName,
            where = params.where,
            insert = params.insert,
            update = params.update
        })
        return self
    end

    ---Commit the transaction
    ---@param callback function Callback function(success, result)
    function tx:commit(callback)
        if type(callback) ~= "function" then
            error("Transaction:commit() - callback must be a function")
        end

        if #self.operations == 0 then
            callback(false, "Transaction has no operations")
            return
        end

        if #self.operations > 10 then
            callback(false, "Transaction exceeds maximum 10 operations")
            return
        end

        exports[cfxDbResource]:executeTransaction(self.operations, callback)
    end

    ---Get the number of operations in the transaction
    ---@return number
    function tx:size()
        return #self.operations
    end

    ---Clear all operations
    ---@return table self for chaining
    function tx:clear()
        self.operations = {}
        return self
    end

    return tx
end

-- Expose transaction API (GENERIC - no application logic)
_G.DBTransaction = {
    create = create,
}

-- Add to main DB namespace
if DB then
    DB.transaction = create
    log.debug("Transaction API registered")
end

return create
