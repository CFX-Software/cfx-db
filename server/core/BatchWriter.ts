import type { FunctionReference } from "convex/server";
import { ConnectionManager } from "./ConnectionManager";
import type { Config } from "../config";

/**
 * BatchWriter - Batches mutations for optimal performance
 *
 * Features:
 * - Priority queues (immediate, high, normal, low)
 * - Automatic flushing based on time/size
 * - Promise-based result delivery
 * - Configurable batch sizes
 */

type Priority = "immediate" | "high" | "normal" | "low";

interface QueuedWrite {
    id: string;
    mutation: FunctionReference<"mutation">;
    args: any;
    priority: Priority;
    timestamp: number;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
}

export class BatchWriter {
    private static instance: BatchWriter | null = null;

    private readonly MAX_QUEUE_SIZE = 10000; // Prevent memory exhaustion
    private queues: Map<Priority, QueuedWrite[]> = new Map([
        ["immediate", []],
        ["high", []],
        ["normal", []],
        ["low", []],
    ]);

    private flushTimers: Map<Priority, number> = new Map();
    private writeCounter: number = 0;
    private isDisposed: boolean = false;

    private constructor(private config: Config) {}

    static getInstance(config?: Config): BatchWriter {
        if (!BatchWriter.instance || BatchWriter.instance.isDisposed) {
            if (!config) {
                throw new Error("Config required for first initialization");
            }
            BatchWriter.instance = new BatchWriter(config);
        }
        return BatchWriter.instance;
    }

    /**
     * Check if instance exists and is not disposed
     */
    static hasInstance(): boolean {
        return BatchWriter.instance !== null && !BatchWriter.instance.isDisposed;
    }

    /**
     * Reset the singleton instance
     */
    static resetInstance(): void {
        if (BatchWriter.instance) {
            BatchWriter.instance.dispose();
        }
        BatchWriter.instance = null;
    }

    /**
     * Queue a write operation
     */
    async queueWrite<T>(
        mutation: FunctionReference<"mutation">,
        args: any,
        priority: Priority = "normal"
    ): Promise<T> {
        if (this.isDisposed) {
            throw new Error("BatchWriter has been disposed");
        }

        // Immediate priority bypasses queue
        if (priority === "immediate") {
            return this.executeImmediate(mutation, args);
        }

        return new Promise((resolve, reject) => {
            const write: QueuedWrite = {
                id: `write_${++this.writeCounter}`,
                mutation,
                args,
                priority,
                timestamp: Date.now(),
                resolve,
                reject,
            };

            const queue = this.queues.get(priority)!;

            // Prevent queue overflow
            if (queue.length >= this.MAX_QUEUE_SIZE) {
                console.error(`[cfx-db] Queue overflow for ${priority}, dropping oldest`);
                const dropped = queue.shift();
                if (dropped) {
                    dropped.reject(new Error("Queue overflow - request dropped"));
                }
            }

            queue.push(write);

            // Schedule flush if not already scheduled
            this.scheduleFlush(priority);

            // Check if we should flush immediately due to batch size
            if (queue.length >= this.config.batchMaxSize) {
                this.flush(priority);
            }
        });
    }

    /**
     * Execute a write immediately (bypasses queue)
     */
    private async executeImmediate<T>(
        mutation: FunctionReference<"mutation">,
        args: any
    ): Promise<T> {
        const client = ConnectionManager.getInstance().getHttpClient();
        return client.mutation(mutation, args);
    }

    /**
     * Schedule a flush for a priority queue
     */
    private scheduleFlush(priority: Priority): void {
        if (this.flushTimers.has(priority)) {
            return; // Already scheduled
        }

        const interval = this.getFlushInterval(priority);
        const timer = setTimeout(() => {
            this.flushTimers.delete(priority);
            this.flush(priority);
        }, interval);

        this.flushTimers.set(priority, timer as any);
    }

    /**
     * Get flush interval for a priority level
     */
    private getFlushInterval(priority: Priority): number {
        switch (priority) {
            case "high":
                return 10;
            case "normal":
                return this.config.batchFlushIntervalMs;
            case "low":
                return 200;
            default:
                return this.config.batchFlushIntervalMs;
        }
    }

    /**
     * Flush a priority queue
     */
    private async flush(priority: Priority): Promise<void> {
        const queue = this.queues.get(priority)!;
        if (queue.length === 0) return;

        // Take batch from queue
        const batch = queue.splice(0, this.config.batchMaxSize);

        // Execute mutations in chunks to avoid overwhelming Convex
        const MAX_CONCURRENT = 10;
        const client = ConnectionManager.getInstance().getHttpClient();

        for (let i = 0; i < batch.length; i += MAX_CONCURRENT) {
            const chunk = batch.slice(i, i + MAX_CONCURRENT);
            await Promise.allSettled(
                chunk.map(async (write) => {
                    try {
                        const result = await client.mutation(write.mutation, write.args);
                        write.resolve(result);
                    } catch (error) {
                        write.reject(error as Error);
                    }
                })
            );
        }

        // If queue still has items, schedule another flush
        if (queue.length > 0) {
            this.scheduleFlush(priority);
        }
    }

    /**
     * Force flush all queues
     */
    async flushAll(): Promise<void> {
        const promises: Promise<void>[] = [];

        for (const priority of ["high", "normal", "low"] as Priority[]) {
            const timer = this.flushTimers.get(priority);
            if (timer) {
                clearTimeout(timer);
                this.flushTimers.delete(priority);
            }
            promises.push(this.flush(priority));
        }

        await Promise.all(promises);
    }

    /**
     * Get queue statistics
     */
    getStats(): {
        queueSizes: Record<Priority, number>;
        totalQueued: number;
    } {
        const queueSizes = {
            immediate: 0,
            high: this.queues.get("high")!.length,
            normal: this.queues.get("normal")!.length,
            low: this.queues.get("low")!.length,
        };

        return {
            queueSizes,
            totalQueued: queueSizes.high + queueSizes.normal + queueSizes.low,
        };
    }

    /**
     * Cleanup and dispose
     */
    dispose(): void {
        if (this.isDisposed) {
            return;
        }

        this.isDisposed = true;

        // Clear all timers
        for (const timer of this.flushTimers.values()) {
            clearTimeout(timer);
        }
        this.flushTimers.clear();

        // Reject all pending writes
        for (const queue of this.queues.values()) {
            for (const write of queue) {
                write.reject(new Error("BatchWriter disposed"));
            }
            queue.length = 0;
        }

        console.log("[cfx-db] BatchWriter disposed");
    }
}
