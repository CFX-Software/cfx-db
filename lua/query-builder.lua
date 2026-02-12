--[[
    Query Builder for cfx-db
    Chainable API for building complex queries

    Example:
        DB.from('players')
            :where('money', '>', 100000)
            :where('online', true)
            :orderBy('money', 'desc')
            :limit(10)
            :get()
]]

QueryBuilder = {}
QueryBuilder.__index = QueryBuilder

local function getDB()
    if not DB then
        error("QueryBuilder: DB is not initialized")
    end
    return DB
end

---Create a new query builder
---@param table string Table name
---@return QueryBuilder
function QueryBuilder.new(table)
    local self = setmetatable({}, QueryBuilder)
    self.table = table
    self.wheres = {}
    self.orderBys = {}
    self.limitVal = nil
    self.offsetVal = nil
    self.selectFields = nil
    return self
end

-- ============================================
-- WHERE CLAUSES
-- ============================================

---Add a WHERE condition
---@param field string|function Field name or closure function
---@param operator? string Operator (=, !=, >, <, >=, <=) - optional if value is provided
---@param value? any Value to compare
---@return QueryBuilder
function QueryBuilder:where(field, operator, value)
    -- Handle closure functions for complex where
    if type(field) == 'function' then
        -- Create a new query builder for the subquery
        local subBuilder = QueryBuilder.new(self.table)
        field(subBuilder)
        -- Merge wheres with OR logic
        table.insert(self.wheres, {
            type = 'GROUP',
            conditions = subBuilder.wheres
        })
        return self
    end

    -- Support where(field, value) or where(field, operator, value)
    if value == nil then
        value = operator
        operator = '='
    end

    table.insert(self.wheres, {
        field = field,
        operator = operator,
        value = value,
        type = 'AND'
    })
    return self
end

---Add an OR WHERE condition
---@param field string Field name
---@param operator? string Operator
---@param value? any Value
---@return QueryBuilder
function QueryBuilder:orWhere(field, operator, value)
    if value == nil then
        value = operator
        operator = '='
    end

    table.insert(self.wheres, {
        field = field,
        operator = operator,
        value = value,
        type = 'OR'
    })
    return self
end

---WHERE IN clause
---@param field string Field name
---@param values table Array of values
---@return QueryBuilder
function QueryBuilder:whereIn(field, values)
    table.insert(self.wheres, {
        field = field,
        operator = 'IN',
        value = values,
        type = 'AND'
    })
    return self
end

---WHERE NOT IN clause
---@param field string Field name
---@param values table Array of values
---@return QueryBuilder
function QueryBuilder:whereNotIn(field, values)
    table.insert(self.wheres, {
        field = field,
        operator = 'NOT IN',
        value = values,
        type = 'AND'
    })
    return self
end

---WHERE NULL clause
---@param field string Field name
---@return QueryBuilder
function QueryBuilder:whereNull(field)
    table.insert(self.wheres, {
        field = field,
        operator = '=',
        value = nil,
        type = 'AND'
    })
    return self
end

---WHERE NOT NULL clause
---@param field string Field name
---@return QueryBuilder
function QueryBuilder:whereNotNull(field)
    table.insert(self.wheres, {
        field = field,
        operator = '!=',
        value = nil,
        type = 'AND'
    })
    return self
end

-- ============================================
-- ORDERING
-- ============================================

---Order results by field
---@param field string Field name
---@param direction? string Direction: 'asc' or 'desc' (default: 'asc')
---@return QueryBuilder
function QueryBuilder:orderBy(field, direction)
    direction = direction or 'asc'
    self.orderBys[field] = direction:lower()
    return self
end

---Order by descending
---@param field string Field name
---@return QueryBuilder
function QueryBuilder:orderByDesc(field)
    return self:orderBy(field, 'desc')
end

-- ============================================
-- LIMITING
-- ============================================

---Limit number of results
---@param limit number Max results
---@return QueryBuilder
function QueryBuilder:limit(limit)
    self.limitVal = limit
    return self
end

---Alias for limit()
---@param take number Max results
---@return QueryBuilder
function QueryBuilder:take(take)
    return self:limit(take)
end

---Offset results (skip first N)
---@param offset number Number to skip
---@return QueryBuilder
function QueryBuilder:offset(offset)
    self.offsetVal = offset
    return self
end

---Alias for offset()
---@param skip number Number to skip
---@return QueryBuilder
function QueryBuilder:skip(skip)
    return self:offset(skip)
end

---Paginate results
---@param page number Page number (1-indexed)
---@param perPage number Items per page
---@return QueryBuilder
function QueryBuilder:paginate(page, perPage)
    perPage = perPage or 20
    page = page or 1

    local offset = (page - 1) * perPage
    return self:limit(perPage):offset(offset)
end

-- ============================================
-- FIELD SELECTION
-- ============================================

---Select specific fields
---@param fields table|string Array of field names or single field
---@return QueryBuilder
function QueryBuilder:select(fields)
    if type(fields) == 'string' then
        self.selectFields = {fields}
    else
        self.selectFields = fields
    end
    return self
end

-- ============================================
-- EXECUTION
-- ============================================

---Execute query and get results
---@param callback? function Optional callback
---@return any results or Promise
function QueryBuilder:get(callback)
    local DB = getDB()
    return DB.select(self.table, self:buildOptions(), callback)
end

---Get first result
---@param callback? function Optional callback
---@return any row or Promise
function QueryBuilder:first(callback)
    self.limitVal = 1

    if callback then
        local DB = getDB()
        DB.select(self.table, self:buildOptions(), function(rows)
            callback(rows and rows[1] or nil)
        end)
        return nil
    else
        local DB = getDB()
        local rows = DB.select(self.table, self:buildOptions())
        return rows and rows[1] or nil
    end
end

---Count matching rows
---@param callback? function Optional callback
---@return any count or Promise
function QueryBuilder:count(callback)
    local DB = getDB()
    return DB.count(self.table, {
        where = self:buildWhere()
    }, callback)
end

---Check if any rows exist
---@param callback? function Optional callback
---@return any boolean or Promise
function QueryBuilder:exists(callback)
    self.limitVal = 1

    if callback then
        self:count(function(count)
            callback(count > 0)
        end)
        return nil
    else
        local count = self:count()
        return count > 0
    end
end

-- ============================================
-- MUTATIONS
-- ============================================

---Update matching rows
---@param data table Data to update
---@param callback? function Optional callback
---@return any result or Promise
function QueryBuilder:update(data, callback)
    local DB = getDB()
    return DB.update(self.table, {
        where = self:buildWhere(),
        set = data
    }, callback)
end

---Delete matching rows
---@param callback? function Optional callback
---@return any result or Promise
function QueryBuilder:delete(callback)
    local DB = getDB()
    return DB.delete(self.table, {
        where = self:buildWhere()
    }, callback)
end

-- ============================================
-- REAL-TIME SUBSCRIPTIONS
-- ============================================

---Subscribe to query changes
---@param callback function Callback fired when data changes
---@return function unsubscribe function
function QueryBuilder:subscribe(callback)
    local DB = getDB()
    return DB.subscribe(self.table, self:buildOptions(), callback)
end

-- ============================================
-- INTERNAL HELPERS
-- ============================================

---Build options object from builder state
---@return table options
function QueryBuilder:buildOptions()
    return {
        where = self:buildWhere(),
        orderBy = self.orderBys,
        limit = self.limitVal,
        offset = self.offsetVal,
        select = self.selectFields
    }
end

---Build where clause from conditions
---@return table|nil where object or array
function QueryBuilder:buildWhere()
    if #self.wheres == 0 then
        return nil
    end

    -- If all conditions are simple AND with = operator, return object format
    local allSimple = true
    for _, where in ipairs(self.wheres) do
        if where.type ~= 'AND' or where.operator ~= '=' then
            allSimple = false
            break
        end
    end

    if allSimple then
        -- Return simple object format {field: value}
        local simple = {}
        for _, where in ipairs(self.wheres) do
            simple[where.field] = where.value
        end
        return simple
    end

    -- Otherwise return array format for complex queries
    return self.wheres
end

-- ============================================
-- DEBUGGING
-- ============================================

---Print query details (for debugging)
---@return QueryBuilder
function QueryBuilder:dump()
    print('=== Query Builder Debug ===')
    print('Table:', self.table)
    print('Where:', json.encode(self:buildWhere() or {}))
    print('OrderBy:', json.encode(self.orderBys))
    print('Limit:', self.limitVal)
    print('Offset:', self.offsetVal)
    print('Select:', json.encode(self.selectFields or {}))
    print('==========================')
    return self
end

---Convert to options object (useful for debugging)
---@return table options
function QueryBuilder:toOptions()
    return self:buildOptions()
end

-- Export
return QueryBuilder
