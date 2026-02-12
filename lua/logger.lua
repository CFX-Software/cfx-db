--[[
    CFX-DB Lua Logger

    Professional logging with FiveM color codes and level filtering.
    Mirrors the TypeScript Logger API for consistency.

    Usage:
        local log = Log.scoped("myComponent")
        log.debug("Verbose info")
        log.info("Important message")
        log.warn("Warning message", { key = "value" })
        log.error("Error occurred", { error = err })
]]

local Logger = {}

-- FiveM console color codes
local COLORS = {
    debug = "^7",   -- White/default
    info = "^2",    -- Green
    warn = "^3",    -- Yellow
    error = "^1",   -- Red
    reset = "^7",   -- Reset to default
    prefix = "^5",  -- Magenta for prefix
}

-- Log level numeric values (must match server)
local LEVEL_VALUES = {
    debug = 0,
    info = 1,
    warn = 2,
    error = 3,
}

-- Current configuration
local currentLevel = "info"
local currentLevelValue = 1
local prefix = "[cfx-db]"

---Initialize logger with level
---@param level string Log level from config
function Logger.init(level)
    level = level or "info"
    if LEVEL_VALUES[level] then
        currentLevel = level
        currentLevelValue = LEVEL_VALUES[level]
    end
end

---Set log level at runtime
---@param level string
function Logger.setLevel(level)
    if LEVEL_VALUES[level] then
        currentLevel = level
        currentLevelValue = LEVEL_VALUES[level]
    end
end

---Get current log level
---@return string
function Logger.getLevel()
    return currentLevel
end

---Check if a level is enabled (for zero-overhead conditional logging)
---@param level string
---@return boolean
function Logger.isEnabled(level)
    local levelValue = LEVEL_VALUES[level] or 1
    return levelValue >= currentLevelValue
end

---Encode data to JSON string safely
---@param data table|nil
---@return string
local function encodeData(data)
    if not data or type(data) ~= "table" then
        return ""
    end

    -- Check if table is empty
    local isEmpty = true
    for _ in pairs(data) do
        isEmpty = false
        break
    end
    if isEmpty then
        return ""
    end

    local success, result = pcall(json.encode, data)
    if success and result then
        return " " .. result
    end
    return ""
end

---Core logging function
---@param level string
---@param category string
---@param message string
---@param data? table
local function log(level, category, message, data)
    local levelValue = LEVEL_VALUES[level] or 1
    if levelValue < currentLevelValue then
        return
    end

    local color = COLORS[level] or COLORS.reset
    local categoryTag = category and string.format("[%s] ", category) or ""
    local dataStr = encodeData(data)

    print(string.format(
        "%s%s%s %s%s%s%s",
        COLORS.prefix,
        prefix,
        COLORS.reset,
        color,
        categoryTag,
        message,
        dataStr
    ))
end

---Log at debug level
---@param category string
---@param message string
---@param data? table
function Logger.debug(category, message, data)
    log("debug", category, message, data)
end

---Log at info level
---@param category string
---@param message string
---@param data? table
function Logger.info(category, message, data)
    log("info", category, message, data)
end

---Log at warn level
---@param category string
---@param message string
---@param data? table
function Logger.warn(category, message, data)
    log("warn", category, message, data)
end

---Log at error level
---@param category string
---@param message string
---@param data? table
function Logger.error(category, message, data)
    log("error", category, message, data)
end

---Create a scoped logger for a specific category
---@param category string
---@return table ScopedLogger
function Logger.scoped(category)
    return {
        isEnabled = function(level)
            return Logger.isEnabled(level)
        end,
        debug = function(msg, data)
            Logger.debug(category, msg, data)
        end,
        info = function(msg, data)
            Logger.info(category, msg, data)
        end,
        warn = function(msg, data)
            Logger.warn(category, msg, data)
        end,
        error = function(msg, data)
            Logger.error(category, msg, data)
        end,
    }
end

-- Initialize from shared config on load
Citizen.CreateThread(function()
    Citizen.Wait(0) -- Wait one frame to ensure Config is loaded
    if Config and Config.LogLevel then
        Logger.init(Config.LogLevel)
    end
end)

-- Export globally for other Lua files
_G.Log = Logger

return Logger
