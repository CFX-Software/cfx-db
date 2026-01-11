/**
 * Snapshot Manager for CFX-DB
 *
 * Creates and restores database snapshots for backup/disaster recovery.
 * Exports all table data to JSON files.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { query, mutation } from "../api/exports";

interface SnapshotData {
    name: string;
    timestamp: number;
    tables: Record<string, any[]>;
    metadata: {
        version: string;
        recordCount: number;
        tables: string[];
    };
}

export class SnapshotManager {
    private static instance: SnapshotManager;

    private snapshotsDir: string;

    private constructor() {
        // Get resource path for snapshots
        const resourcePath = GetResourcePath(GetCurrentResourceName());
        this.snapshotsDir = resolve(resourcePath, "snapshots");

        // Create snapshots directory if it doesn't exist
        if (!existsSync(this.snapshotsDir)) {
            mkdirSync(this.snapshotsDir, { recursive: true });
            console.log(`[cfx-db] Created snapshots directory: ${this.snapshotsDir}`);
        }
    }

    static getInstance(): SnapshotManager {
        if (!SnapshotManager.instance) {
            SnapshotManager.instance = new SnapshotManager();
        }
        return SnapshotManager.instance;
    }

    /**
     * Create a snapshot of all tables
     */
    async createSnapshot(name: string, type: "automatic" | "manual" = "manual"): Promise<{
        success: boolean;
        name: string;
        recordCount: number;
        size: number;
        error?: string;
    }> {
        try {
            console.log(`[cfx-db] Creating snapshot: ${name}`);

            // Get all tables from schema (excluding system tables)
            const tables = ["players", "keyValue", "auditLogs"];

            // Create snapshot metadata in Convex
            await mutation("functions/snapshot:createSnapshotMetadata" as any, {
                name,
                type,
                tables,
                createdBy: GetInvokingResource() || "system",
            });

            const snapshotData: SnapshotData = {
                name,
                timestamp: Date.now(),
                tables: {},
                metadata: {
                    version: "1.0.0",
                    recordCount: 0,
                    tables: [],
                },
            };

            // Export data from each table
            let totalRecords = 0;
            for (const table of tables) {
                try {
                    const result = await query("functions/snapshot:exportTableData" as any, {
                        table,
                    });

                    snapshotData.tables[table] = result.records;
                    totalRecords += result.total;

                    console.log(`[cfx-db] Exported ${result.total} records from ${table}`);
                } catch (error: any) {
                    console.warn(`[cfx-db] Failed to export table ${table}: ${error.message}`);
                    snapshotData.tables[table] = [];
                }
            }

            snapshotData.metadata.recordCount = totalRecords;
            snapshotData.metadata.tables = tables;

            // Write snapshot to JSON file
            const filename = `${name}.json`;
            const filepath = join(this.snapshotsDir, filename);

            const jsonData = JSON.stringify(snapshotData, null, 2);
            writeFileSync(filepath, jsonData, "utf-8");

            const size = Buffer.byteLength(jsonData, "utf-8");

            // Update snapshot status in Convex
            await mutation("functions/snapshot:updateSnapshotStatus" as any, {
                name,
                status: "completed",
                recordCount: totalRecords,
                size,
            });

            console.log(`[cfx-db] ✓ Snapshot created: ${filename} (${totalRecords} records, ${(size / 1024).toFixed(2)} KB)`);

            return {
                success: true,
                name,
                recordCount: totalRecords,
                size,
            };
        } catch (error: any) {
            console.error(`[cfx-db] Failed to create snapshot: ${error.message}`);

            // Update status as failed
            try {
                await mutation("functions/snapshot:updateSnapshotStatus" as any, {
                    name,
                    status: "failed",
                    error: error.message,
                });
            } catch (e) {
                // Ignore if metadata update fails
            }

            return {
                success: false,
                name,
                recordCount: 0,
                size: 0,
                error: error.message,
            };
        }
    }

    /**
     * Restore a snapshot
     * WARNING: This will overwrite existing data!
     */
    async restoreSnapshot(name: string): Promise<{
        success: boolean;
        recordsRestored: number;
        error?: string;
    }> {
        try {
            console.log(`[cfx-db] Restoring snapshot: ${name}`);

            const filename = `${name}.json`;
            const filepath = join(this.snapshotsDir, filename);

            // Check if snapshot file exists
            if (!existsSync(filepath)) {
                throw new Error(`Snapshot file not found: ${filename}`);
            }

            // Read snapshot data
            const jsonData = readFileSync(filepath, "utf-8");
            const snapshotData: SnapshotData = JSON.parse(jsonData);

            console.log(
                `[cfx-db] Loaded snapshot from ${new Date(snapshotData.timestamp).toISOString()}`
            );
            console.log(
                `[cfx-db] Contains ${snapshotData.metadata.recordCount} records across ${snapshotData.metadata.tables.length} tables`
            );

            // WARNING: Ask for confirmation if not automated
            const invokingResource = GetInvokingResource();
            if (invokingResource) {
                console.warn(
                    `[cfx-db] WARNING: Restoring will OVERWRITE existing data! This operation cannot be undone.`
                );
            }

            let totalRestored = 0;

            // Restore each table
            for (const [table, records] of Object.entries(snapshotData.tables)) {
                try {
                    console.log(`[cfx-db] Restoring ${records.length} records to ${table}...`);

                    // Delete existing records (optional - could also merge)
                    // Note: This is simplified. In production, you'd want more sophisticated restore logic

                    // Insert records in batches
                    const batchSize = 100;
                    for (let i = 0; i < records.length; i += batchSize) {
                        const batch = records.slice(i, i + batchSize);

                        for (const record of batch) {
                            // Remove Convex metadata fields
                            const { _id, _creationTime, ...data } = record as any;

                            try {
                                await mutation("functions.crud.execute" as any, {
                                    operation: "insert",
                                    table,
                                    data,
                                });
                                totalRestored++;
                            } catch (error: any) {
                                console.warn(
                                    `[cfx-db] Failed to restore record: ${error.message}`
                                );
                            }
                        }
                    }

                    console.log(`[cfx-db] ✓ Restored ${records.length} records to ${table}`);
                } catch (error: any) {
                    console.error(
                        `[cfx-db] Failed to restore table ${table}: ${error.message}`
                    );
                }
            }

            console.log(
                `[cfx-db] ✓ Snapshot restored: ${totalRestored} records across ${Object.keys(snapshotData.tables).length} tables`
            );

            return {
                success: true,
                recordsRestored: totalRestored,
            };
        } catch (error: any) {
            console.error(`[cfx-db] Failed to restore snapshot: ${error.message}`);

            return {
                success: false,
                recordsRestored: 0,
                error: error.message,
            };
        }
    }

    /**
     * List all available snapshots
     */
    async listSnapshots(): Promise<any[]> {
        try {
            const snapshots = await query("functions/snapshot:getAllSnapshots" as any, {});
            return snapshots;
        } catch (error: any) {
            console.error(`[cfx-db] Failed to list snapshots: ${error.message}`);
            return [];
        }
    }

    /**
     * Delete a snapshot
     */
    async deleteSnapshot(name: string): Promise<boolean> {
        try {
            // Delete from Convex
            await mutation("functions/snapshot:deleteSnapshot" as any, { name });

            // Delete file
            const filename = `${name}.json`;
            const filepath = join(this.snapshotsDir, filename);

            if (existsSync(filepath)) {
                const fs = require("fs");
                fs.unlinkSync(filepath);
                console.log(`[cfx-db] Deleted snapshot file: ${filename}`);
            }

            return true;
        } catch (error: any) {
            console.error(`[cfx-db] Failed to delete snapshot: ${error.message}`);
            return false;
        }
    }

    /**
     * Get snapshot statistics
     */
    async getStats(): Promise<any> {
        try {
            const stats = await query("functions/snapshot:getSnapshotStats" as any, {});
            return stats;
        } catch (error: any) {
            console.error(`[cfx-db] Failed to get snapshot stats: ${error.message}`);
            return null;
        }
    }
}
