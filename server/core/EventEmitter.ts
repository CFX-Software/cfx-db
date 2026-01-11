/**
 * Event Emitter for CFX-DB
 *
 * Internal event bus for database operations.
 * Allows resources to subscribe to database events.
 */

type EventCallback = (data: any) => void;

export class EventEmitter {
    private static instance: EventEmitter;

    private listeners: Map<string, EventCallback[]> = new Map();

    private constructor() {}

    static getInstance(): EventEmitter {
        if (!EventEmitter.instance) {
            EventEmitter.instance = new EventEmitter();
        }
        return EventEmitter.instance;
    }

    /**
     * Subscribe to an event
     */
    on(event: string, callback: EventCallback): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }

        this.listeners.get(event)!.push(callback);
    }

    /**
     * Unsubscribe from an event
     */
    off(event: string, callback: EventCallback): void {
        const callbacks = this.listeners.get(event);
        if (!callbacks) return;

        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }

        if (callbacks.length === 0) {
            this.listeners.delete(event);
        }
    }

    /**
     * Emit an event
     */
    emit(event: string, data: any): void {
        const callbacks = this.listeners.get(event);
        if (!callbacks || callbacks.length === 0) return;

        for (const callback of callbacks) {
            try {
                callback(data);
            } catch (error) {
                console.error(`[cfx-db] Event listener error for '${event}':`, error);
            }
        }

        // Also emit wildcard events
        if (!event.endsWith(":*") && !event.startsWith("*")) {
            // Emit table-level wildcard (e.g., "players:*")
            const parts = event.split(":");
            if (parts.length > 1) {
                this.emit(`${parts[0]}:*`, data);
            }

            // Emit global wildcard
            this.emit("*", data);
        }
    }

    /**
     * Get listener count for an event
     */
    listenerCount(event: string): number {
        return this.listeners.get(event)?.length || 0;
    }

    /**
     * Get all event names with listeners
     */
    eventNames(): string[] {
        return Array.from(this.listeners.keys());
    }

    /**
     * Remove all listeners for an event
     */
    removeAllListeners(event?: string): void {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }

    /**
     * Get statistics
     */
    getStats(): {
        eventCount: number;
        listenerCount: number;
        events: Record<string, number>;
    } {
        const events: Record<string, number> = {};
        let totalListeners = 0;

        for (const [event, callbacks] of this.listeners.entries()) {
            events[event] = callbacks.length;
            totalListeners += callbacks.length;
        }

        return {
            eventCount: this.listeners.size,
            listenerCount: totalListeners,
            events,
        };
    }
}
