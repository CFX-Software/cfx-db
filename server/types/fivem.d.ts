/**
 * FiveM Server-Side Type Definitions
 */

declare global {
    // FiveM Globals
    function GetCurrentResourceName(): string;
    function GetConvar(varName: string, default_: string): string;
    function GetConvarInt(varName: string, default_: number): number;
    function GetResourcePath(resourceName: string): string;
    function GetInvokingResource(): string | null;
    function ExecuteCommand(commandString: string): void;
    function RegisterCommand(
        commandName: string,
        handler: (source: number, args: string[], raw: string) => void,
        restricted: boolean
    ): void;
    function GetPlayerIdentifiers(source: string | number): string[];
    function GetPlayerName(source: string | number): string;
    function GetPlayers(): string[];
    function GetPlayerPing(source: string | number): number;
    function GetPlayerEndpoint(source: string | number): string;

    // Events
    function emit(eventName: string, ...args: any[]): void;
    function on(eventName: string, callback: (...args: any[]) => void): void;
    function onNet(eventName: string, callback: (...args: any[]) => void): void;
    function emitNet(eventName: string, source: number | string, ...args: any[]): void;
    function TriggerEvent(eventName: string, ...args: any[]): void;
    function TriggerClientEvent(
        eventName: string,
        source: number | string,
        ...args: any[]
    ): void;
    function TriggerLatentClientEvent(
        eventName: string,
        source: number | string,
        bps: number,
        ...args: any[]
    ): void;

    // Timers
    function setImmediate(callback: () => void): void;
    function setTick(callback: () => void): number;
    function clearTick(id: number): void;
    function setTimeout(callback: () => void, ms: number): number;
    function setInterval(callback: () => void, ms: number): number;
    function clearTimeout(id: number): void;
    function clearInterval(id: number): void;

    // State Bags
    const Player: (source: string | number) => {
        state: {
            [key: string]: any;
            set(key: string, value: any, replicated: boolean): void;
        };
    };

    const GlobalState: {
        [key: string]: any;
        set(key: string, value: any, replicated: boolean): void;
    };

    // Exports
    const exports: {
        [resourceName: string]: any;
    };

    // Console
    const console: Console;

    // Node.js globals
    const process: NodeJS.Process;
    const __dirname: string;
    const __filename: string;
}

export {};
