/**
 * Migration CLI Tool for CFX-DB
 *
 * Usage:
 *   bun run migrate:status        - Show current migration status
 *   bun run migrate:record <version> <name>  - Record a migration as applied
 *   bun run migrate:create <name>  - Create a new migration file
 *   bun run migrate:list          - List all migrations
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";

const CONVEX_URL = process.env["CONVEX_URL"] || process.env["NEXT_PUBLIC_CONVEX_URL"];

if (!CONVEX_URL) {
    console.error("Error: CONVEX_URL not found in environment variables");
    console.error("Please set CONVEX_URL in your .env file");
    process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL);

async function getStatus() {
    console.log("Fetching migration status...\n");

    const stats = await client.query(api.functions.migrations.getMigrationStats);

    console.log("=".repeat(60));
    console.log("MIGRATION STATUS");
    console.log("=".repeat(60));
    console.log(`Current Version: ${stats.currentVersion}`);
    console.log(`Total Migrations: ${stats.total}`);
    console.log(`Successful: ${stats.successful}`);
    console.log(`Failed: ${stats.failed}`);
    console.log("=".repeat(60));

    if (stats.migrations.length > 0) {
        console.log("\nMigration History:");
        console.log("-".repeat(60));
        for (const migration of stats.migrations) {
            const status = migration.success ? "✓" : "✗";
            const date = new Date(migration.appliedAt).toISOString().split("T")[0];
            console.log(
                `${status} v${migration.version.toString().padStart(3, "0")} - ${migration.name.padEnd(30)} (${date})`
            );
            if (!migration.success && migration.error) {
                console.log(`    Error: ${migration.error}`);
            }
        }
        console.log("-".repeat(60));
    } else {
        console.log("\nNo migrations applied yet.");
    }
}

async function recordMigration(version: number, name: string) {
    console.log(`Recording migration v${version}: ${name}...`);

    try {
        const result = await client.mutation(api.functions.migrations.recordMigration, {
            version,
            name,
            success: true,
        });

        console.log(`✓ Migration v${version} recorded successfully!`);
        console.log(`  ID: ${result.id}`);
        console.log(`  Name: ${result.name}`);
    } catch (error: any) {
        console.error(`✗ Failed to record migration: ${error.message}`);
        process.exit(1);
    }
}

async function listMigrations() {
    console.log("Listing all migrations...\n");

    const migrations = await client.query(api.functions.migrations.getAppliedMigrations);

    if (migrations.length === 0) {
        console.log("No migrations found.");
        return;
    }

    console.log("=".repeat(80));
    console.log("ALL MIGRATIONS");
    console.log("=".repeat(80));

    for (const migration of migrations) {
        const status = migration.success ? "SUCCESS" : "FAILED";
        const date = new Date(migration.appliedAt).toLocaleString();

        console.log(`\nVersion: ${migration.version}`);
        console.log(`Name: ${migration.name}`);
        console.log(`Status: ${status}`);
        console.log(`Applied: ${date}`);

        if (!migration.success && migration.error) {
            console.log(`Error: ${migration.error}`);
        }

        console.log("-".repeat(80));
    }
}

async function createMigration(name: string) {
    // Get current version
    const currentVersion = await client.query(api.functions.migrations.getCurrentVersion);
    const newVersion = currentVersion + 1;

    const migrationName = name.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    const versionStr = newVersion.toString().padStart(3, "0");
    const filename = `${versionStr}_${migrationName}.md`;

    const migrationsDir = resolve(__dirname, "../../convex/migrations");
    const filepath = join(migrationsDir, filename);

    // Create migrations directory if it doesn't exist
    if (!existsSync(migrationsDir)) {
        mkdirSync(migrationsDir, { recursive: true });
    }

    // Check if file already exists
    if (existsSync(filepath)) {
        console.error(`Error: Migration file already exists: ${filename}`);
        process.exit(1);
    }

    // Create migration file from template
    const template = `# Migration ${versionStr}: ${name}

**Version:** ${newVersion}
**Name:** ${migrationName}
**Date:** ${new Date().toISOString().split("T")[0]}
**Author:** Your Name

## Description

Brief description of what this migration does.

## Changes

### Added Tables

List any new tables added:
\`\`\`typescript
// Example:
// tableName: defineTable({ ... })
//   .index("by_field", ["field"])
\`\`\`

### Modified Tables

List any modifications to existing tables:
- Added fields
- Removed fields
- Index changes

### Removed Tables

List any tables removed (be careful!)

## Deployment

1. Update \`convex/schema.ts\` with your changes
2. Deploy with \`npx convex deploy\`
3. Record migration with \`bun run migrate:record ${newVersion} ${migrationName}\`

## Rollback

Describe how to rollback this migration if needed.

**WARNING:** Always backup before rolling back!

## Notes

Any additional notes or considerations for this migration.
`;

    writeFileSync(filepath, template, "utf-8");

    console.log(`✓ Created migration file: ${filename}`);
    console.log(`  Version: ${newVersion}`);
    console.log(`  Path: ${filepath}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Edit the migration file with your schema changes`);
    console.log(`  2. Update convex/schema.ts with the changes`);
    console.log(`  3. Deploy with: npx convex deploy`);
    console.log(`  4. Record with: bun run migrate:record ${newVersion} ${migrationName}`);
}

// Main CLI
const command = process.argv[2];
const args = process.argv.slice(3);

(async () => {
    try {
        switch (command) {
            case "status":
                await getStatus();
                break;

            case "record":
                if (args.length < 2) {
                    console.error("Usage: bun run migrate:record <version> <name>");
                    process.exit(1);
                }
                const versionArg = args[0];
                if (!versionArg) {
                    console.error("Usage: bun run migrate:record <version> <name>");
                    process.exit(1);
                }
                const version = parseInt(versionArg, 10);
                if (Number.isNaN(version)) {
                    console.error("Version must be a valid number");
                    process.exit(1);
                }
                const name = args.slice(1).join(" ");
                await recordMigration(version, name);
                break;

            case "create":
                if (args.length < 1) {
                    console.error("Usage: bun run migrate:create <name>");
                    process.exit(1);
                }
                await createMigration(args.join(" "));
                break;

            case "list":
                await listMigrations();
                break;

            default:
                console.log("CFX-DB Migration CLI\n");
                console.log("Usage:");
                console.log("  bun run migrate:status           - Show current migration status");
                console.log("  bun run migrate:list             - List all migrations");
                console.log("  bun run migrate:create <name>    - Create a new migration file");
                console.log("  bun run migrate:record <v> <name> - Record a migration as applied");
                console.log("\nExamples:");
                console.log("  bun run migrate:create add_vehicles_table");
                console.log("  bun run migrate:record 2 add_vehicles_table");
                process.exit(command ? 1 : 0);
        }

        process.exit(0);
    } catch (error: any) {
        console.error("Error:", error.message);
        process.exit(1);
    }
})();
