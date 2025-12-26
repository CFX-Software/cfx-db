--[[
    Event Subscription API for CFX-DB

    Subscribe to database events in real-time.

    Example usage:
        -- Subscribe to player inserts
        DB.on('players:insert', function(event)
            print("New player:", event.data.name)
        end)

        -- Subscribe to all player events
        DB.on('players:*', function(event)
            print("Player event:", event.operation, event.data)
        end)

        -- Subscribe to all database events
        DB.on('*', function(event)
            print("DB event:", event.table, event.operation)
        end)

        -- Unsubscribe
        local listener = DB.on('players:insert', callback)
        DB.off('players:insert', listener)
]]

local Events = {}

-- Local event listeners (stored by event name)
local listeners = {}

---Subscribe to a database event
---@param event string Event pattern (e.g., "players:insert", "players:*", "*")
---@param callback function Callback function(event)
---@return function listener The callback function (use for unsubscribing)
function Events.on(event, callback)
    if type(event) ~= "string" then
        error("Events.on: event must be a string")
    end

    if type(callback) ~= "function" then
        error("Events.on: callback must be a function")
    end

    -- Subscribe to TypeScript EventEmitter
    exports['cfx-db']:subscribeToEvent(event, callback)

    -- Also track locally for stats
    if not listeners[event] then
        listeners[event] = {}
    end
    table.insert(listeners[event], callback)

    return callback
end

---Unsubscribe from a database event
---@param event string Event pattern
---@param callback function The callback function to remove
---@return boolean success Whether the listener was found and removed
function Events.off(event, callback)
    if type(event) ~= "string" then
        error("Events.off: event must be a string")
    end

    if type(callback) ~= "function" then
        error("Events.off: callback must be a function")
    end

    -- Unsubscribe from TypeScript EventEmitter
    exports['cfx-db']:unsubscribeFromEvent(event, callback)

    -- Remove from local tracking
    local eventListeners = listeners[event]
    if not eventListeners then
        return false
    end

    -- Find and remove callback
    for i, listener in ipairs(eventListeners) do
        if listener == callback then
            table.remove(eventListeners, i)

            -- Cleanup empty listener arrays
            if #eventListeners == 0 then
                listeners[event] = nil
            end

            return true
        end
    end

    return false
end

---Emit a database event (internal use - not needed, events are emitted from TypeScript)
---@param eventData table Event data {event, table, operation, data, timestamp, ...}
function Events.emit(eventData)
    -- Events are now emitted directly from TypeScript EventEmitter
    -- This function is kept for API compatibility but does nothing
    print("[cfx-db] Warning: Events.emit is deprecated. Events are emitted automatically from database operations.")
end

---Get listener count for an event
---@param event string Event pattern
---@return number count Number of listeners
function Events.listenerCount(event)
    if type(event) ~= "string" then
        error("Events.listenerCount: event must be a string")
    end

    local eventListeners = listeners[event]
    return eventListeners and #eventListeners or 0
end

---Get all event names with listeners
---@return table events Array of event names
function Events.eventNames()
    local events = {}
    for event, _ in pairs(listeners) do
        table.insert(events, event)
    end
    return events
end

---Remove all listeners for an event
---@param event string|nil Event pattern (nil to remove all)
function Events.removeAllListeners(event)
    if event == nil then
        listeners = {}
    else
        if type(event) ~= "string" then
            error("Events.removeAllListeners: event must be a string or nil")
        end
        listeners[event] = nil
    end
end

---Get event statistics
---@return table stats {eventCount, listenerCount, events}
function Events.getStats()
    local totalListeners = 0
    local eventDetails = {}

    for event, eventListeners in pairs(listeners) do
        local count = #eventListeners
        eventDetails[event] = count
        totalListeners = totalListeners + count
    end

    return {
        eventCount = #Events.eventNames(),
        listenerCount = totalListeners,
        events = eventDetails
    }
end

-- Cleanup listeners when resource stops
AddEventHandler('onResourceStop', function(resourceName)
    if resourceName == GetCurrentResourceName() then
        print("[cfx-db] Cleaning up event listeners...")
        Events.removeAllListeners()
    end
end)

-- Expose events API
_G.DBEvents = Events

-- Add to main DB namespace
if DB then
    DB.on = Events.on
    DB.off = Events.off
    DB.emit = Events.emit
    DB.listenerCount = Events.listenerCount
    DB.eventNames = Events.eventNames
    DB.removeAllListeners = Events.removeAllListeners
    DB.getEventStats = Events.getStats
end

return Events
