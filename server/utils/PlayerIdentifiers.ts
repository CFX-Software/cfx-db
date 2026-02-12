/**
 * Resolve player identifiers in a runtime-safe way.
 *
 * Different FiveM runtimes can expose different native name casing.
 * This helper tries known variants and falls back to indexed identifier natives.
 */
export function getPlayerIdentifiersSafe(source: number | string): string[] {
    const runtime = global as any;

    const direct =
        runtime.GetPlayerIdentifiers ||
        runtime.getPlayerIdentifiers;

    if (typeof direct === "function") {
        try {
            const identifiers = direct(source);
            return Array.isArray(identifiers) ? identifiers : [];
        } catch {
            // Fall through to other strategies.
        }
    }

    const getNum =
        runtime.GetNumPlayerIdentifiers ||
        runtime.getNumPlayerIdentifiers;
    const getByIndex =
        runtime.GetPlayerIdentifier ||
        runtime.getPlayerIdentifier;

    if (typeof getNum === "function" && typeof getByIndex === "function") {
        const count = Number(getNum(source)) || 0;
        const identifiers: string[] = [];
        for (let i = 0; i < count; i++) {
            const id = getByIndex(source, i);
            if (typeof id === "string" && id.length > 0) {
                identifiers.push(id);
            }
        }
        return identifiers;
    }

    return [];
}
