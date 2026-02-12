/**
 * AccessControl - Resource-based access control for tables
 *
 * Controls which FiveM resources can read/write to which tables.
 * Default ALLOW all mode - tables are accessible unless explicitly restricted.
 */

import { Logger } from "../utils/Logger";

interface TablePermissions {
    read: string[];  // Resource names allowed to read ('*' = all)
    write: string[]; // Resource names allowed to write ('*' = all)
}

export class AccessControl {
    private static instance: AccessControl;
    private permissions: Map<string, TablePermissions> = new Map();

    private constructor() {
        // Load permissions from config if available
        this.loadPermissions();
    }

    static getInstance(): AccessControl {
        if (!AccessControl.instance) {
            AccessControl.instance = new AccessControl();
        }
        return AccessControl.instance;
    }

    /**
     * Load table permissions from config
     */
    private loadPermissions(): void {
        try {
            // Try to get permissions from Lua config
            const Config = (global as any).Config;
            if (Config && Config.TablePermissions) {
                for (const [table, perms] of Object.entries(Config.TablePermissions)) {
                    this.setTablePermissions(table, perms as any);
                }
                Logger.getInstance().scoped("access").debug("Loaded table permissions", { tables: this.permissions.size });
            }
        } catch (error) {
            // Config not available yet, permissions can be set later
            Logger.getInstance().scoped("access").debug("No table permissions configured (default allow all)");
        }
    }

    /**
     * Set permissions for a table
     */
    setTablePermissions(table: string, permissions: { read: string[], write: string[] }): void {
        this.permissions.set(table, {
            read: permissions.read || ['*'],
            write: permissions.write || ['*'],
        });
    }

    /**
     * Check if a resource can access a table
     * @param resourceName The resource making the request
     * @param table The table being accessed
     * @param operation 'read' for queries, 'write' for mutations
     * @returns true if allowed, false if denied
     */
    canAccess(resourceName: string, table: string, operation: 'read' | 'write'): boolean {
        const perms = this.permissions.get(table);

        // If no permissions configured for this table, allow all (default ALLOW)
        if (!perms) {
            return true;
        }

        const allowedResources = operation === 'read' ? perms.read : perms.write;

        // Check if resource is in allowed list or if '*' (all) is allowed
        return allowedResources.includes('*') || allowedResources.includes(resourceName);
    }

    /**
     * Get all table permissions (for debugging)
     */
    getPermissions(): Map<string, TablePermissions> {
        return new Map(this.permissions);
    }

    /**
     * Clear all permissions (for testing)
     */
    clearPermissions(): void {
        this.permissions.clear();
    }
}
