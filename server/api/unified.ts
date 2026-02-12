/**
 * Unified DB API
 *
 * Mirrors the Lua DB.* ergonomics for JavaScript/TypeScript consumers
 * while keeping Promise-first support.
 */

import { mutation, query, subscribe } from "./exports";

type DbCallback<T = any> = (result: T | null, error?: string) => void;

interface CrudOptions {
    where?: any;
    orderBy?: any;
    limit?: number;
    offset?: number;
    select?: string[];
}

interface UpdateOptions extends CrudOptions {
    set?: any;
    data?: any;
}

interface UpsertOptions {
    where: any;
    insert: any;
    update: any;
}

interface RelationQueryOptions {
    where?: any;
    options?: {
        orderBy?: any;
        limit?: number;
        offset?: number;
        select?: string[];
    };
    relations: any[];
}

interface RelationCountOptions {
    where?: any;
    relation: any;
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return String(error);
}

function withDbCallback<T>(
    promise: Promise<T>,
    callback?: DbCallback<T>
): Promise<T> | void {
    if (!callback) {
        return promise;
    }

    promise
        .then((result) => callback(result))
        .catch((error) => callback(null, toErrorMessage(error)));
}

function buildQueryOptions(options: CrudOptions = {}): CrudOptions | undefined {
    const queryOptions: CrudOptions = {};

    if (options.orderBy !== undefined) queryOptions.orderBy = options.orderBy;
    if (options.limit !== undefined) queryOptions.limit = options.limit;
    if (options.offset !== undefined) queryOptions.offset = options.offset;
    if (options.select !== undefined) queryOptions.select = options.select;

    return Object.keys(queryOptions).length > 0 ? queryOptions : undefined;
}

function buildReadPayload(operation: "select" | "count", table: string, options: CrudOptions = {}) {
    const payload: Record<string, unknown> = {
        operation,
        table,
    };

    if (options.where !== undefined) {
        payload["where"] = options.where;
    }

    const queryOptions = buildQueryOptions(options);
    if (queryOptions) {
        payload["options"] = queryOptions;
    }

    return payload;
}

function buildWritePayload(
    operation: "insert" | "update" | "delete",
    table: string,
    options: UpdateOptions = {}
) {
    const payload: Record<string, unknown> = {
        operation,
        table,
    };

    if (options.where !== undefined) {
        payload["where"] = options.where;
    }

    const data = options.data ?? options.set;
    if (data !== undefined) {
        payload["data"] = data;
    }

    const queryOptions = buildQueryOptions(options);
    if (queryOptions) {
        payload["options"] = queryOptions;
    }

    return payload;
}

export function insert<T = any>(
    table: string,
    data: any,
    callback?: DbCallback<T>
): Promise<T> | void {
    return withDbCallback(
        mutation<T>("functions/crud:execute", { operation: "insert", table, data }) as Promise<T>,
        callback
    );
}

export function insertMany<T = any>(
    table: string,
    records: any[],
    callback?: DbCallback<T>
): Promise<T> | void {
    return withDbCallback(
        mutation<T>("functions/crud:insertMany", { table, records }) as Promise<T>,
        callback
    );
}

export function select<T = any[]>(
    table: string,
    options: CrudOptions = {},
    callback?: DbCallback<T>
): Promise<T> | void {
    const payload = buildReadPayload("select", table, options);
    return withDbCallback(query<T>("functions/crud:read", payload) as Promise<T>, callback);
}

export function selectOne<T = any>(
    table: string,
    options: CrudOptions = {},
    callback?: DbCallback<T>
): Promise<T | null> | void {
    const singleOptions = { ...options, limit: 1 };
    const promise = (select<any[]>(table, singleOptions) as Promise<any[]>).then(
        (rows) => (Array.isArray(rows) && rows.length > 0 ? (rows[0] as T) : null)
    );
    return withDbCallback(promise, callback as DbCallback<T | null>);
}

export function update<T = any>(
    table: string,
    options: UpdateOptions,
    callback?: DbCallback<T>
): Promise<T> | void {
    const payload = buildWritePayload("update", table, options);
    return withDbCallback(
        mutation<T>("functions/crud:execute", payload) as Promise<T>,
        callback
    );
}

export function updateMany<T = any>(
    table: string,
    updates: Array<{ where: any; set: any }>,
    callback?: DbCallback<T>
): Promise<T> | void {
    return withDbCallback(
        mutation<T>("functions/crud:updateMany", { table, updates }) as Promise<T>,
        callback
    );
}

function removeRows<T = any>(
    table: string,
    options: CrudOptions = {},
    callback?: DbCallback<T>
): Promise<T> | void {
    const payload = buildWritePayload("delete", table, options);
    return withDbCallback(
        mutation<T>("functions/crud:execute", payload) as Promise<T>,
        callback
    );
}

export function count(
    table: string,
    options: CrudOptions = {},
    callback?: DbCallback<number>
): Promise<number> | void {
    const payload = buildReadPayload("count", table, options);
    return withDbCallback(
        query<number>("functions/crud:read", payload) as Promise<number>,
        callback
    );
}

export function upsert<T = any>(
    table: string,
    options: UpsertOptions,
    callback?: DbCallback<T>
): Promise<T> | void {
    const payload = {
        operation: "upsert",
        table,
        where: options.where,
        insert: options.insert,
        update: options.update,
    };

    return withDbCallback(
        mutation<T>("functions/crud:execute", payload) as Promise<T>,
        callback
    );
}

export function watch<T = any[]>(
    table: string,
    options: CrudOptions = {},
    onUpdate: (data: T) => void,
    subscriberId?: string
): () => void {
    const payload = buildReadPayload("select", table, options);
    return subscribe("functions/crud:read", payload, onUpdate, subscriberId);
}

export function relations<T = any[]>(
    table: string,
    params: RelationQueryOptions,
    callback?: DbCallback<T>
): Promise<T> | void {
    const args = {
        table,
        where: params.where,
        options: params.options,
        relations: params.relations,
    };

    return withDbCallback(
        query<T>("functions/relations:queryWithRelations", args) as Promise<T>,
        callback
    );
}

export function relationsCount<T = any>(
    table: string,
    params: RelationCountOptions,
    callback?: DbCallback<T>
): Promise<T> | void {
    const args = {
        table,
        where: params.where,
        relation: params.relation,
    };

    return withDbCallback(
        query<T>("functions/relations:countWithRelations", args) as Promise<T>,
        callback
    );
}

export function transaction<T = any>(
    operations: any[],
    callback?: DbCallback<T>
): Promise<T> | void {
    return withDbCallback(
        mutation<T>("functions/transaction:executeTransaction", { operations }) as Promise<T>,
        callback
    );
}

export function queryRaw<T = any>(
    queryName: string,
    args: any = {},
    callback?: DbCallback<T>
): Promise<T> | void {
    return withDbCallback(query<T>(queryName, args) as Promise<T>, callback);
}

export function mutationRaw<T = any>(
    mutationName: string,
    args: any = {},
    callback?: DbCallback<T>
): Promise<T> | void {
    return withDbCallback(mutation<T>(mutationName, args) as Promise<T>, callback);
}

if (typeof global.exports !== "undefined") {
    global.exports("insert", insert);
    global.exports("insertMany", insertMany);
    global.exports("select", select);
    global.exports("selectOne", selectOne);
    global.exports("update", update);
    global.exports("updateMany", updateMany);
    global.exports("delete", removeRows);
    global.exports("count", count);
    global.exports("upsert", upsert);
    global.exports("watch", watch);
    global.exports("relations", relations);
    global.exports("relationsCount", relationsCount);
    global.exports("transaction", transaction);
    global.exports("queryRaw", queryRaw);
    global.exports("mutationRaw", mutationRaw);
}
