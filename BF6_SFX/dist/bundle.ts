// --- BUNDLED TYPESCRIPT OUTPUT ---
// @ts-nocheck

// --- SOURCE: node_modules\bf6-portal-utils\logging\index.ts ---
// version: 1.0.2
export class Logging {
    constructor(tag: string) {
        this._tag = tag;
    }

    private _tag: string;

    private _logLevel: Logging.LogLevel = Logging.LogLevel.Info;

    private _includeError: boolean = false;

    private _logger?: (text: string) => Promise<void> | void;

    /**
     * Safely converts an error of unknown type to a string.
     * This method cannot throw - it will always return a string.
     * @param error - The error to convert to a string.
     * @returns The error as a string.
     */
    private _safeErrorToString(error: unknown): string {
        try {
            if (error instanceof Error) {
                // Try to get the message, but handle cases where .message might throw.
                try {
                    return error.message || 'Error';
                } catch {
                    return 'Error (message unavailable)';
                }
            }
            // Try `String()` conversion, but handle cases where `toString()` might throw.
            try {
                return String(error);
            } catch {
                return '[Error object]';
            }
        } catch {
            // Ultimate fallback - this should never happen, but ensures we always return a string.
            return '[Unable to stringify error]';
        }
    }

    /**
     * Checks if a message with the given log level would actually be logged.
     * Use this to avoid building expensive log messages when logging is disabled or below the threshold.
     * @param logLevel - The log level to check.
     * @returns True if logging will occur, false otherwise.
     */
    public willLog(logLevel: Logging.LogLevel): boolean {
        return this._logger !== undefined && logLevel >= this._logLevel;
    }

    public log(text: string, logLevel: Logging.LogLevel = Logging.LogLevel.Warning, error?: unknown): void {
        if (!this._logger || logLevel < this._logLevel) return;

        try {
            const errorText = this._includeError && error ? ` - Error: ${this._safeErrorToString(error)}` : '';
            const result = this._logger(`<${this._tag}> ${text}${errorText}`);

            if (result instanceof Promise) {
                result.catch((error) => {
                    // Catch and log async logger errors to prevent unhandled promise rejections.
                    console.log(`<${this._tag}> Error in async logger:`, error);
                });
            }
        } catch (error: unknown) {
            // Catch and log sync logger errors so the logging functionality can still run.
            console.log(`<${this._tag}> Error in sync logger:`, error);
        }
    }

    /**
     * Attaches a logger and defines a minimum log level and whether to include the runtime error in the log.
     * @param log - The logger function to use. Pass undefined to disable logging.
     * @param logLevel - The minimum log level to use.
     * @param includeError - Whether to attempt to include the runtime error, if any, as a string in the log.
     */
    public setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        this._logger = log;
        this._logLevel = logLevel ?? Logging.LogLevel.Warning;
        this._includeError = includeError ?? false;
    }
}

export namespace Logging {
    /**
     * The log levels.
     */
    export enum LogLevel {
        Debug = 0,
        Info = 1,
        Warning = 2,
        Error = 3,
    }
}


// --- SOURCE: node_modules\bf6-portal-utils\callback-handler\index.ts ---


// version: 1.0.0
export namespace CallbackHandler {
    /**
     * Safely invokes a callback that may be sync or async, catching and logging errors.
     * @param callback - The callback to invoke (may be undefined).
     * @param args - Arguments to pass to the callback.
     * @param errorContext - Context for error messages.
     * @param logging - Logging instance to use for error reporting.
     * @param logLevel - Log level for error messages.
     */
    export function invoke<T extends (...args: any[]) => Promise<void> | void>(
        callback: T | undefined,
        args: Parameters<T>,
        errorContext: string,
        logging: Logging,
        logLevel: Logging.LogLevel = Logging.LogLevel.Error
    ): void {
        if (!callback) return;

        try {
            const result = callback(...args);

            if (result instanceof Promise) {
                result.catch((error: unknown) => {
                    // Catch and log async errors to prevent unhandled promise rejections.
                    logging.log(
                        `Error in async ${errorContext} ${callback.name ?? 'anonymous'} callback:`,
                        logLevel,
                        error
                    );
                });
            }
        } catch (error: unknown) {
            // Catch and log sync errors so the invoking code can still run.
            logging.log(`Error in sync ${errorContext} ${callback?.name ?? 'anonymous'} callback:`, logLevel, error);
        }
    }

    /**
     * Safely invokes a callback with no arguments that may be sync or async, catching and logging errors.
     * @param callback - The callback to invoke (may be undefined).
     * @param errorContext - Context for error messages.
     * @param logging - Logging instance to use for error reporting.
     * @param logLevel - Log level for error messages.
     */
    export function invokeNoArgs(
        callback: (() => Promise<void> | void) | undefined,
        errorContext: string,
        logging: Logging,
        logLevel: Logging.LogLevel = Logging.LogLevel.Error
    ): void {
        invoke(callback, [], errorContext, logging, logLevel);
    }
}


// --- SOURCE: node_modules\bf6-portal-utils\timers\index.ts ---



// version: 1.2.0
export namespace Timers {
    const logging = new Logging('Timers');

    /**
     * A re-export of the `Logging.LogLevel` enum.
     */
    export const LogLevel = Logging.LogLevel;

    /**
     * Attaches a logger and defines a minimum log level and whether to include the runtime error in the log.
     * @param log - The logger function to use. Pass undefined to disable logging.
     * @param logLevel - The minimum log level to use.
     * @param includeError - Whether to include the runtime error in the log.
     */
    export function setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeError);
    }

    const ACTIVE_IDS = new Set<number>();

    let nextId: number = 1;

    async function executeTimeout(id: number, callback: () => Promise<void> | void, ms: number): Promise<void> {
        await Promise.resolve();
        await mod.Wait(ms / 1_000);

        if (!ACTIVE_IDS.has(id)) return; // Exit if the timer is no longer active.

        ACTIVE_IDS.delete(id); // Cleanup one-time timer.

        CallbackHandler.invokeNoArgs(callback, `timeout ${id}`, logging, LogLevel.Error);
    }

    async function executeInterval(
        id: number,
        callback: () => Promise<void> | void,
        ms: number,
        immediate: boolean
    ): Promise<void> {
        await Promise.resolve();

        // Skip the first wait if immediate is true.
        if (!immediate && ACTIVE_IDS.has(id)) {
            await mod.Wait(ms / 1_000);
        }

        do {
            if (!ACTIVE_IDS.has(id)) return;

            CallbackHandler.invokeNoArgs(callback, `interval ${id}`, logging, LogLevel.Error);

            if (!ACTIVE_IDS.has(id)) return;

            await mod.Wait(ms / 1_000);
            // eslint-disable-next-line no-constant-condition
        } while (true);
    }

    /**
     * Schedules a one-time execution after the specified delay.
     * @param callback - The callback to execute.
     * @param ms - The delay in milliseconds.
     * @returns The timer ID.
     */
    export function setTimeout(callback: () => Promise<void> | void, ms: number): number {
        const id = nextId++;
        ACTIVE_IDS.add(id);

        // Run async without awaiting (fire-and-forget).
        executeTimeout(id, callback, ms < 0 ? 0 : ms);

        return id;
    }

    /**
     * Schedules a repeated execution after the specified interval.
     * @param callback - The callback to execute. Synchronous callbacks will delay the start of the next interval.
     * @param ms - The interval in milliseconds.
     * @param immediate - If true, runs the callback immediately before the first wait period.
     * @returns The timer ID.
     */
    export function setInterval(callback: () => Promise<void> | void, ms: number, immediate: boolean = false): number {
        const id = nextId++;
        ACTIVE_IDS.add(id);

        // Run async without awaiting (fire-and-forget).
        executeInterval(id, callback, ms < 0 ? 0 : ms, immediate);

        return id;
    }

    /**
     * Cancels a timeout (or interval). Silently ignores null, undefined, or invalid IDs.
     * @param id - The timer ID to cancel.
     */
    export function clearTimeout(id: number | undefined | null): void {
        clear(id);
    }

    /**
     * Cancels an interval (or timeout). Silently ignores null, undefined, or invalid IDs.
     * @param id - The timer ID to cancel.
     */
    export function clearInterval(id: number | undefined | null): void {
        clear(id);
    }

    /**
     * Cancels a timeout or interval. Silently ignores null, undefined, or invalid IDs.
     * @param id - The timer ID to cancel.
     */
    export function clear(id: number | undefined | null): void {
        if (id === undefined || id === null) return;

        ACTIVE_IDS.delete(id);
    }

    /**
     * @returns The number of active timers.
     */
    export function getActiveTimerCount(): number {
        return ACTIVE_IDS.size;
    }
}


// --- SOURCE: node_modules\bf6-portal-utils\events\index.ts ---




// version: 1.5.1
namespace EventsTypes {
    /**
     * Map of each event name to its trigger function. Use for typed references to event payloads
     * (e.g. `Parameters<typeof Events.Type.OnPlayerDied>`) or dynamic dispatch. Prefer the channel API
     * (`Events.OnPlayerDied.subscribe(handler)`) for subscribe/trigger with full IntelliSense.
     */
    export const Type = {
        OngoingGlobal,
        OngoingAreaTrigger,
        OngoingCapturePoint,
        OngoingEmplacementSpawner,
        OngoingHQ,
        OngoingInteractPoint,
        OngoingLootSpawner,
        OngoingMCOM,
        OngoingPlayer,
        OngoingRingOfFire,
        OngoingSector,
        OngoingSpawner,
        OngoingSpawnPoint,
        OngoingTeam,
        OngoingVehicle,
        OngoingVehicleSpawner,
        OngoingWaypointPath,
        OngoingWorldIcon,
        OnAIMoveToFailed,
        OnAIMoveToRunning,
        OnAIMoveToSucceeded,
        OnAIParachuteRunning,
        OnAIParachuteSucceeded,
        OnAIWaypointIdleFailed,
        OnAIWaypointIdleRunning,
        OnAIWaypointIdleSucceeded,
        OnCapturePointCaptured,
        OnCapturePointCapturing,
        OnCapturePointLost,
        OnGameModeEnding,
        OnGameModeStarted,
        OnMandown,
        OnMCOMArmed,
        OnMCOMDefused,
        OnMCOMDestroyed,
        OnPlayerDamaged,
        OnPlayerDeployed,
        OnPlayerDied,
        OnPlayerEarnedKill,
        OnPlayerEarnedKillAssist,
        OnPlayerEnterAreaTrigger,
        OnPlayerEnterCapturePoint,
        OnPlayerEnterVehicle,
        OnPlayerEnterVehicleSeat,
        OnPlayerEnterVL7Cloud,
        OnPlayerExitAreaTrigger,
        OnPlayerExitCapturePoint,
        OnPlayerExitVehicle,
        OnPlayerExitVehicleSeat,
        OnPlayerExitVL7Cloud,
        OnPlayerInteract,
        OnPlayerJoinGame,
        OnPlayerLeaveGame,
        OnPlayerSwitchTeam,
        OnPlayerUIButtonEvent,
        OnPlayerUndeploy,
        OnPortalGadgetAimStart,
        OnPortalGadgetAimStop,
        OnPortalGadgetFireStart,
        OnPortalGadgetFireStop,
        OnPortalGadgetLaserToggle,
        OnRayCastHit,
        OnRayCastMissed,
        OnRevived,
        OnRingOfFireZoneSizeChange,
        OnSpawnerSpawned,
        OnTimeLimitReached,
        OnVehicleDestroyed,
        OnVehicleSpawned,
    } as const;

    /**
     * Extract parameters from a function type.
     */
    export type Parameters<T> = T extends (...args: infer P) => void ? P : never;

    /**
     * Trigger function types (single source of truth); same shape as Events.Type.
     */
    export type Signature = typeof Type;

    /**
     * One of the trigger function names (a key from Events.Type).
     */
    export type SignatureKey = keyof Signature;

    /**
     * One of the trigger functions (a value from Events.Type).
     */
    export type TypeValue = Signature[SignatureKey];

    /**
     * Typed channel for a single event. Each event (e.g. `Events.OngoingInteractPoint`, `Events.OnPlayerDied`)
     * exposes this interface with `subscribe`, `unsubscribe`, and `trigger` typed to that event's payload.
     * @template K - Event name; handler and trigger args are inferred from the corresponding trigger function.
     */
    export type Channel<K extends SignatureKey> = {
        /**
         * Subscribe a handler for this event. The handler receives the same arguments as this event's trigger.
         * @param handler - Callback invoked when the event is triggered; args match the event's payload.
         * @returns Function to call to unsubscribe this handler.
         */
        subscribe(handler: (...args: Parameters<Signature[K]>) => void | Promise<void>): () => void;

        /**
         * Unsubscribe a handler previously added with `subscribe`. Pass the same function reference.
         * @param handler - The same function reference that was passed to `subscribe`.
         */
        unsubscribe(handler: (...args: Parameters<Signature[K]>) => void | Promise<void>): void;

        /**
         * Trigger this event. Pass the same arguments as the exported trigger function for this event.
         * @param args - Event payload; types match the corresponding standalone trigger function (e.g. `OnPlayerDied`).
         */
        trigger(...args: Parameters<Signature[K]>): void;

        /**
         * Return the number of handlers currently subscribed to this event.
         * @returns Count of subscribed handlers (0 if none).
         */
        handlerCount(): number;
    };

    /**
     * Map of each event name to its typed channel (`subscribe`, `unsubscribe`, `trigger`, `handlerCount`).
     * Merged onto the Events namespace so you get e.g. `Events.OngoingInteractPoint.subscribe(handler)`.
     */
    export type ChannelsMap = {
        [K in SignatureKey]: K extends SignatureKey ? Channel<K> : never;
    };

    // Get the event key (name) from a trigger function value.
    type TypeName<T extends TypeValue> = {
        [K in SignatureKey]: Signature[K] extends T ? K : never;
    }[SignatureKey];

    /**
     * Get the handler function type for a specific event type.
     * Handlers can be synchronous or asynchronous (returning void or Promise<void>).
     */
    export type HandlerForType<T extends TypeValue> =
        TypeName<T> extends SignatureKey
            ? Signature[TypeName<T>] extends (...args: infer P) => void
                ? (...args: P) => void | Promise<void>
                : never
            : never;

    /**
     * Get the parameter tuple for a specific event type.
     */
    export type EventParameters<T extends TypeValue> =
        TypeName<T> extends SignatureKey ? Parameters<Signature[TypeName<T>]> : never;

    /**
     * Create a union of all possible handler types.
     * Handlers can be synchronous or asynchronous (returning void or Promise<void>).
     */
    export type AllHandlers = {
        [K in SignatureKey]: Signature[K] extends (...args: infer P) => void
            ? (...args: P) => void | Promise<void>
            : never;
    }[SignatureKey];

    export type State = {
        logTimeout?: number;
        incompleteTriggers: number;
        handlers: Set<EventsTypes.AllHandlers>;
    };
}

class EventsImplementation {
    private static readonly _LOG_TIMEOUT_MS = 10_000;

    private static readonly _logging = new Logging('Events');

    private static readonly _states = new Map<EventsTypes.TypeValue, EventsTypes.State>();

    /**
     * The event types.
     */
    public static readonly Type = EventsTypes.Type;

    /**
     * The logging levels.
     */
    public static readonly LogLevel = Logging.LogLevel;

    static {
        /** Build per-event channel objects so users can call Events.OngoingInteractPoint.subscribe(handler), etc. */
        const typeKeys = Object.keys(EventsTypes.Type) as EventsTypes.SignatureKey[];

        for (const key of typeKeys) {
            const typeValue = EventsTypes.Type[key];

            (
                EventsImplementation as unknown as Record<
                    EventsTypes.SignatureKey,
                    EventsTypes.Channel<EventsTypes.SignatureKey>
                >
            )[key] = {
                subscribe(handler: EventsTypes.AllHandlers): () => void {
                    return EventsImplementation.subscribe(
                        typeValue,
                        handler as EventsTypes.HandlerForType<typeof typeValue>
                    );
                },
                unsubscribe(handler: EventsTypes.AllHandlers): void {
                    EventsImplementation.unsubscribe(
                        typeValue,
                        handler as EventsTypes.HandlerForType<typeof typeValue>
                    );
                },
                trigger(...args: EventsTypes.Parameters<EventsTypes.AllHandlers>): void {
                    EventsImplementation.trigger(typeValue, ...(args as EventsTypes.EventParameters<typeof typeValue>));
                },
                handlerCount(): number {
                    return EventsImplementation.handlerCount(typeValue);
                },
            };
        }
    }

    private constructor() {}

    private static getSate(type: EventsTypes.TypeValue): EventsTypes.State {
        const state = EventsImplementation._states.get(type);

        if (state) return state;

        const createdState: EventsTypes.State = {
            incompleteTriggers: 0,
            handlers: new Set<EventsTypes.AllHandlers>(),
        };

        EventsImplementation._states.set(type, createdState);

        return createdState;
    }

    /**
     * Attaches a logger and defines a minimum log level and whether to include the runtime error in the log.
     * @param log - The logger function to use. Pass undefined to disable logging.
     * @param logLevel - The minimum log level to use.
     * @param includeError - Whether to include the runtime error in the log.
     */
    public static setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        EventsImplementation._logging.setLogging(log, logLevel, includeError);
    }

    /**
     * Subscribe to an event.
     * @param type - The event type to subscribe to.
     * @param handler - The handler function to call when the event is triggered.
     * @returns A function to unsubscribe from the event.
     */
    public static subscribe<T extends EventsTypes.TypeValue>(
        type: T,
        handler: EventsTypes.HandlerForType<T>
    ): () => void {
        const state = EventsImplementation.getSate(type);

        state.handlers.add(handler as EventsTypes.AllHandlers);

        const unsubscriber = () => EventsImplementation.unsubscribe(type, handler);

        return unsubscriber;
    }

    /**
     * Unsubscribe from an event.
     * @param type - The event type to unsubscribe from.
     * @param handler - The handler function that was subscribed.
     */
    public static unsubscribe<T extends EventsTypes.TypeValue>(type: T, handler: EventsTypes.HandlerForType<T>): void {
        const state = EventsImplementation.getSate(type);

        state.handlers.delete(handler as EventsTypes.AllHandlers);
    }

    /**
     * Triggers an event.
     * @param type - The event type to trigger.
     * @param args - The arguments to pass to the handler function.
     */
    public static trigger<T extends EventsTypes.TypeValue>(type: T, ...args: EventsTypes.EventParameters<T>): void {
        const state = EventsImplementation.getSate(type);

        const typeName = (type as { name?: string }).name ?? 'unknown';

        // Incomplete-trigger accounting: Portal servers previously aborted the JS thread for a block of synchronous
        // work after ~50ms, so a trigger can be started (increment below) but never reach the decrement. We schedule a
        // one-shot timeout to log how many such incomplete triggers occurred in the last _LOG_TIMEOUT_MS window in
        // order to avoid spamming the log, especially for high-frequency triggers like any of the Ongoing events.
        if (state.incompleteTriggers > 0 && !state.logTimeout) {
            const processIncompleteTriggers = () => {
                state.logTimeout = undefined;

                EventsImplementation._logging.log(
                    `${state.incompleteTriggers} incomplete triggers for ${typeName} in last ${EventsImplementation._LOG_TIMEOUT_MS}ms.`,
                    Logging.LogLevel.Warning
                );

                state.incompleteTriggers = 0;
            };

            state.logTimeout = Timers.setTimeout(processIncompleteTriggers, EventsImplementation._LOG_TIMEOUT_MS);
        }

        ++state.incompleteTriggers;

        // Execute each handler asynchronously and non-blocking.
        // Errors in one handler won't prevent other handlers from executing.
        for (const handler of state.handlers) {
            CallbackHandler.invoke(handler, args, typeName, EventsImplementation._logging, Logging.LogLevel.Error);
        }

        // Decrement runs synchronously after the loop; the only way it is skipped is tick abort (50ms cap).
        --state.incompleteTriggers;
    }

    /**
     * Return the number of handlers currently subscribed to an event.
     * @param type - The event type to query.
     * @returns Count of subscribed handlers (0 if none).
     */
    public static handlerCount<T extends EventsTypes.TypeValue>(type: T): number {
        return EventsImplementation.getSate(type).handlers.size;
    }
}

export const Events = EventsImplementation as typeof EventsImplementation & EventsTypes.ChannelsMap;

/* eslint-disable jsdoc/require-jsdoc */
export function OngoingGlobal(): void {
    Events.OngoingGlobal.trigger();
}

export function OngoingAreaTrigger(areaTrigger: mod.AreaTrigger): void {
    Events.OngoingAreaTrigger.trigger(areaTrigger);
}

export function OngoingCapturePoint(capturePoint: mod.CapturePoint): void {
    Events.OngoingCapturePoint.trigger(capturePoint);
}

export function OngoingEmplacementSpawner(emplacementSpawner: mod.EmplacementSpawner): void {
    Events.OngoingEmplacementSpawner.trigger(emplacementSpawner);
}

export function OngoingHQ(hq: mod.HQ): void {
    Events.OngoingHQ.trigger(hq);
}

export function OngoingInteractPoint(interactPoint: mod.InteractPoint): void {
    Events.OngoingInteractPoint.trigger(interactPoint);
}

export function OngoingLootSpawner(lootSpawner: mod.LootSpawner): void {
    Events.OngoingLootSpawner.trigger(lootSpawner);
}

export function OngoingMCOM(mcom: mod.MCOM): void {
    Events.OngoingMCOM.trigger(mcom);
}

export function OngoingPlayer(player: mod.Player): void {
    Events.OngoingPlayer.trigger(player);
}

export function OngoingRingOfFire(ringOfFire: mod.RingOfFire): void {
    Events.OngoingRingOfFire.trigger(ringOfFire);
}

export function OngoingSector(sector: mod.Sector): void {
    Events.OngoingSector.trigger(sector);
}

export function OngoingSpawner(spawner: mod.Spawner): void {
    Events.OngoingSpawner.trigger(spawner);
}

export function OngoingSpawnPoint(spawnPoint: mod.SpawnPoint): void {
    Events.OngoingSpawnPoint.trigger(spawnPoint);
}

export function OngoingTeam(team: mod.Team): void {
    Events.OngoingTeam.trigger(team);
}

export function OngoingVehicle(vehicle: mod.Vehicle): void {
    Events.OngoingVehicle.trigger(vehicle);
}

export function OngoingVehicleSpawner(vehicleSpawner: mod.VehicleSpawner): void {
    Events.OngoingVehicleSpawner.trigger(vehicleSpawner);
}

export function OngoingWaypointPath(waypointPath: mod.WaypointPath): void {
    Events.OngoingWaypointPath.trigger(waypointPath);
}

export function OngoingWorldIcon(worldIcon: mod.WorldIcon): void {
    Events.OngoingWorldIcon.trigger(worldIcon);
}

export function OnAIMoveToFailed(player: mod.Player): void {
    Events.OnAIMoveToFailed.trigger(player);
}

export function OnAIMoveToRunning(player: mod.Player): void {
    Events.OnAIMoveToRunning.trigger(player);
}

export function OnAIMoveToSucceeded(player: mod.Player): void {
    Events.OnAIMoveToSucceeded.trigger(player);
}

export function OnAIParachuteRunning(player: mod.Player): void {
    Events.OnAIParachuteRunning.trigger(player);
}

export function OnAIParachuteSucceeded(player: mod.Player): void {
    Events.OnAIParachuteSucceeded.trigger(player);
}

export function OnAIWaypointIdleFailed(player: mod.Player): void {
    Events.OnAIWaypointIdleFailed.trigger(player);
}

export function OnAIWaypointIdleRunning(player: mod.Player): void {
    Events.OnAIWaypointIdleRunning.trigger(player);
}

export function OnAIWaypointIdleSucceeded(player: mod.Player): void {
    Events.OnAIWaypointIdleSucceeded.trigger(player);
}

export function OnCapturePointCaptured(capturePoint: mod.CapturePoint): void {
    Events.OnCapturePointCaptured.trigger(capturePoint);
}

export function OnCapturePointCapturing(capturePoint: mod.CapturePoint): void {
    Events.OnCapturePointCapturing.trigger(capturePoint);
}

export function OnCapturePointLost(capturePoint: mod.CapturePoint): void {
    Events.OnCapturePointLost.trigger(capturePoint);
}

export function OnGameModeEnding(): void {
    Events.OnGameModeEnding.trigger();
}

export function OnGameModeStarted(): void {
    Events.OnGameModeStarted.trigger();
}

export function OnMandown(player: mod.Player, otherPlayer: mod.Player): void {
    Events.OnMandown.trigger(player, otherPlayer);
}

export function OnMCOMArmed(mcom: mod.MCOM): void {
    Events.OnMCOMArmed.trigger(mcom);
}

export function OnMCOMDefused(mcom: mod.MCOM): void {
    Events.OnMCOMDefused.trigger(mcom);
}

export function OnMCOMDestroyed(mcom: mod.MCOM): void {
    Events.OnMCOMDestroyed.trigger(mcom);
}

export function OnPlayerDamaged(
    damagedPlayer: mod.Player,
    damagingPlayer: mod.Player,
    damageType: mod.DamageType,
    weapon: mod.WeaponUnlock
): void {
    Events.OnPlayerDamaged.trigger(damagedPlayer, damagingPlayer, damageType, weapon);
}

export function OnPlayerDeployed(player: mod.Player): void {
    Events.OnPlayerDeployed.trigger(player);
}

export function OnPlayerDied(
    victim: mod.Player,
    killer: mod.Player,
    deathType: mod.DeathType,
    weapon: mod.WeaponUnlock
): void {
    Events.OnPlayerDied.trigger(victim, killer, deathType, weapon);
}

export function OnPlayerEarnedKill(
    killer: mod.Player,
    victim: mod.Player,
    deathType: mod.DeathType,
    weapon: mod.WeaponUnlock
): void {
    Events.OnPlayerEarnedKill.trigger(killer, victim, deathType, weapon);
}

export function OnPlayerEarnedKillAssist(assistingPlayer: mod.Player, victim: mod.Player): void {
    Events.OnPlayerEarnedKillAssist.trigger(assistingPlayer, victim);
}

export function OnPlayerEnterAreaTrigger(player: mod.Player, areaTrigger: mod.AreaTrigger): void {
    Events.OnPlayerEnterAreaTrigger.trigger(player, areaTrigger);
}

export function OnPlayerEnterCapturePoint(player: mod.Player, capturePoint: mod.CapturePoint): void {
    Events.OnPlayerEnterCapturePoint.trigger(player, capturePoint);
}

export function OnPlayerEnterVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    Events.OnPlayerEnterVehicle.trigger(player, vehicle);
}

export function OnPlayerEnterVehicleSeat(player: mod.Player, vehicle: mod.Vehicle, seat: mod.Object): void {
    Events.OnPlayerEnterVehicleSeat.trigger(player, vehicle, seat);
}

export function OnPlayerEnterVL7Cloud(player: mod.Player, cloud: mod.VL7Cloud): void {
    Events.OnPlayerEnterVL7Cloud.trigger(player, cloud);
}

export function OnPlayerExitAreaTrigger(player: mod.Player, areaTrigger: mod.AreaTrigger): void {
    Events.OnPlayerExitAreaTrigger.trigger(player, areaTrigger);
}

export function OnPlayerExitCapturePoint(player: mod.Player, capturePoint: mod.CapturePoint): void {
    Events.OnPlayerExitCapturePoint.trigger(player, capturePoint);
}

export function OnPlayerExitVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    Events.OnPlayerExitVehicle.trigger(player, vehicle);
}

export function OnPlayerExitVehicleSeat(player: mod.Player, vehicle: mod.Vehicle, seat: mod.Object): void {
    Events.OnPlayerExitVehicleSeat.trigger(player, vehicle, seat);
}

export function OnPlayerExitVL7Cloud(player: mod.Player, cloud: mod.VL7Cloud): void {
    Events.OnPlayerExitVL7Cloud.trigger(player, cloud);
}

export function OnPlayerInteract(player: mod.Player, interactPoint: mod.InteractPoint): void {
    Events.OnPlayerInteract.trigger(player, interactPoint);
}

export function OnPlayerJoinGame(player: mod.Player): void {
    Events.OnPlayerJoinGame.trigger(player);
}

export function OnPlayerLeaveGame(playerId: number): void {
    Events.OnPlayerLeaveGame.trigger(playerId);
}

export function OnPlayerSwitchTeam(player: mod.Player, team: mod.Team): void {
    Events.OnPlayerSwitchTeam.trigger(player, team);
}

export function OnPlayerUIButtonEvent(
    player: mod.Player,
    uiWidget: mod.UIWidget,
    uiButtonEvent: mod.UIButtonEvent
): void {
    Events.OnPlayerUIButtonEvent.trigger(player, uiWidget, uiButtonEvent);
}

export function OnPlayerUndeploy(player: mod.Player): void {
    Events.OnPlayerUndeploy.trigger(player);
}

export function OnPortalGadgetAimStart(player: mod.Player): void {
    Events.OnPortalGadgetAimStart.trigger(player);
}

export function OnPortalGadgetAimStop(player: mod.Player): void {
    Events.OnPortalGadgetAimStop.trigger(player);
}

export function OnPortalGadgetFireStart(player: mod.Player): void {
    Events.OnPortalGadgetFireStart.trigger(player);
}

export function OnPortalGadgetFireStop(player: mod.Player): void {
    Events.OnPortalGadgetFireStop.trigger(player);
}

export function OnPortalGadgetLaserToggle(player: mod.Player, toggle: boolean): void {
    Events.OnPortalGadgetLaserToggle.trigger(player, toggle);
}

export function OnRayCastHit(player: mod.Player, point: mod.Vector, normal: mod.Vector): void {
    Events.OnRayCastHit.trigger(player, point, normal);
}

export function OnRayCastMissed(player: mod.Player): void {
    Events.OnRayCastMissed.trigger(player);
}

export function OnRevived(revivedPlayer: mod.Player, revivingPlayer: mod.Player): void {
    Events.OnRevived.trigger(revivedPlayer, revivingPlayer);
}

export function OnRingOfFireZoneSizeChange(ringOfFire: mod.RingOfFire, number: number): void {
    Events.OnRingOfFireZoneSizeChange.trigger(ringOfFire, number);
}

export function OnSpawnerSpawned(player: mod.Player, spawner: mod.Spawner): void {
    Events.OnSpawnerSpawned.trigger(player, spawner);
}

export function OnTimeLimitReached(): void {
    if (!mod.GetMatchTimeElapsed()) return; // Avoids a bug where this event is triggered by the server prematurely.

    Events.OnTimeLimitReached.trigger();
}

export function OnVehicleDestroyed(vehicle: mod.Vehicle): void {
    Events.OnVehicleDestroyed.trigger(vehicle);
}

export function OnVehicleSpawned(vehicle: mod.Vehicle): void {
    Events.OnVehicleSpawned.trigger(vehicle);
}
/* eslint-enable jsdoc/require-jsdoc */


// --- SOURCE: node_modules\bf6-portal-utils\performance-stats\index.ts ---




// version: 2.0.1
export namespace PerformanceStats {
    const logging = new Logging('PS');

    /**
     * A re-export of the `Logging.LogLevel` enum.
     */
    export const LogLevel = Logging.LogLevel;

    /**
     * Attaches a logger and defines a minimum log level and whether to include the runtime error in the log.
     * @param log - The logger function to use. Pass undefined to disable logging.
     * @param logLevel - The minimum log level to use.
     * @param includeError - Whether to include the runtime error in the log.
     */
    export function setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeError);
    }

    const TARGET_HZ = 30;
    const TARGET_DELTA_MS = 1_000 / TARGET_HZ; // ~33.33ms if TARGET_HZ is 30.
    const SAMPLE_RATE_MS = 1_000;
    const SMOOTHING_FACTOR = 0.3; // 0.0 to 1.0 (Lower = smoother, Higher = more responsive)

    // Spot State (Updated every tick)
    let lastTickTime = 0;
    let lastTickDeltaMs = TARGET_DELTA_MS;

    // Window State (Updated every second)
    let tickCount = 0;
    let lastWindowTime = 0;
    let lastTimeoutCall = 0;

    // Smoothed Output State (For UI)
    let smoothedTickRate = TARGET_HZ;
    let smoothedTimeoutLagMs = 0;

    function getSmoothedValue(spotValue: number, currentSmoothedValue: number): number {
        return spotValue * SMOOTHING_FACTOR + currentSmoothedValue * (1 - SMOOTHING_FACTOR);
    }

    /**
     * The core timeout lag measurement loop for UI and logging.
     */
    function measureTimeoutLag() {
        const now = Date.now();
        const deltaMs = now - lastWindowTime;

        // Calculate average spot metrics for this specific window.
        const rawTickRate = (tickCount / deltaMs) * 1_000;

        const timeoutLagMs = Math.max(0, now - (lastTimeoutCall + SAMPLE_RATE_MS)); // How late `setTimeout` woke up.

        // Apply exponential moving average (EMA) for UI stability.
        smoothedTickRate = getSmoothedValue(rawTickRate, smoothedTickRate);
        smoothedTimeoutLagMs = getSmoothedValue(timeoutLagMs, smoothedTimeoutLagMs);

        // Instant spike logging.
        if (timeoutLagMs > 100) {
            logging.log(`Timeout lag spike: +${~~timeoutLagMs}ms over.`, LogLevel.Warning);
        }

        if (rawTickRate < 25) {
            logging.log(`Tick rate dropped: ${~~rawTickRate}Hz`, LogLevel.Warning);
        }

        // Reset and schedule next window.
        tickCount = 0;
        lastWindowTime = now;
        lastTimeoutCall = Date.now();

        Timers.setTimeout(measureTimeoutLag, SAMPLE_RATE_MS);
    }

    /**
     * The per-tick tracker for scaling and counting.
     * It's critical this is the first (or one of the first) things subscribed so it accurately captures the
     * engine's tick cadence.
     */
    const trackTick = () => {
        const now = Date.now();

        // Update Spot Math for compute scaling.
        lastTickDeltaMs = now - lastTickTime;
        lastTickTime = now;

        // Accumulate ticks for the window loop.
        ++tickCount;
    };

    const startTrackingTicks = () => {
        unsubscribe();

        Events.OngoingGlobal.subscribe(trackTick);

        // Kick off the macro measurement loop.
        lastTimeoutCall = lastWindowTime = lastTickTime = Date.now();

        Timers.setTimeout(measureTimeoutLag, SAMPLE_RATE_MS);
    };

    const unsubscribe = Events.OnGameModeStarted.subscribe(startTrackingTicks);

    if (logging.willLog(LogLevel.Info)) {
        logging.log(`Monitoring started.`, LogLevel.Info);
    }

    /**
     * @returns The smoothed tick rate. Good/stable for UI display.
     */
    export function getSmoothedTickRate() {
        return smoothedTickRate;
    }

    /**
     * @returns The smoothed lag time. Good/stable for UI display.
     */
    export function getSmoothedTimeoutLagMs() {
        return smoothedTimeoutLagMs;
    }

    /**
     * Returns the value that is somewhat analogous to SFT when above 33m.
     * @returns The raw delta time between the last two ticks. Good for compute scaling.
     */
    export function getSpotDeltaMs() {
        return lastTickDeltaMs;
    }

    /**
     * Returns the value that is analogous to STR.
     * @returns The tick rate. Good for compute scaling.
     */
    export function getSpotTickRate() {
        return TARGET_DELTA_MS / lastTickDeltaMs;
    }

    /**
     * @returns A normalized health factor from 0.0 to 1.0. Good for compute scaling.
     * 1.0 = Perfect 30Hz performance.
     * < 1.0 = Engine is bogged down, scale your compute back.
     */
    export function getSpotHealthFactor() {
        // Cap at 1.0 so a randomly fast tick doesn't cause logic to scale > 100%
        return Math.min(1.0, getSpotTickRate());
    }
}


// --- SOURCE: node_modules\bf6-portal-utils\ui\index.ts ---




// version: 8.0.1
export namespace UI {
    /****** Logging ******/

    const logging = new Logging('UI');

    /**
     * Log levels for controlling logging verbosity.
     */
    export const LogLevel = Logging.LogLevel;

    /**
     * Attaches a logger and defines a minimum log level and whether to include the runtime error in the log.
     * @param log - The logger function to use. Pass undefined to disable logging.
     * @param logLevel - The minimum log level to use.
     * @param includeError - Whether to include the runtime error in the log.
     */
    export function setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeError);
    }

    /****** Types ******/

    /**
     * The type of a button handler.
     */
    export type ButtonHandler = (player: mod.Player) => Promise<void> | void;

    /**
     * The minimum interface for a button.
     */
    export type Button = {
        onClickDown?: ButtonHandler;
        onClickUp?: ButtonHandler;
        onFocusIn?: ButtonHandler;
        onFocusOut?: ButtonHandler;
    };

    /**
     * The parent of an element.
     */
    export type Parent = {
        name: string;
        uiWidget: mod.UIWidget;
        receiver: GlobalReceiver | TeamReceiver | PlayerReceiver;
        children: Element[];
        attachChild(child: Element): void;
        detachChild(child: Element): void;
    };

    type BaseParams = {
        anchor?: mod.UIAnchor;
        parent?: Parent;
        visible?: boolean;
        bgColor?: mod.Vector;
        bgAlpha?: number;
        bgFill?: mod.UIBgFill;
        depth?: mod.UIDepth;
        receiver?: mod.Player | mod.Team;
        uiInputModeWhenVisible?: boolean;
    };

    /**
     * The size of an element.
     */
    export type Size = {
        width: number;
        height: number;
    };

    /**
     * The position of an element.
     */
    export type Position = {
        x: number;
        y: number;
    };

    // EitherPosition type is used to allow either position or x/y.
    type EitherPosition =
        | ({ position?: Position } & { x?: never; y?: never })
        | ({ x?: number; y?: number } & { position?: never });

    // EitherSize type is used to allow either size or width/height.
    type EitherSize =
        | ({ size?: Size } & { width?: never; height?: never })
        | ({ width?: number; height?: number } & { size?: never });

    /**
     * The parameters for a base element.
     */
    export type ElementParams = BaseParams & EitherPosition & EitherSize;

    /**
     * The final internal parameters for an Element constructor.
     */
    export type FinalElementParams = {
        name: string;
        parent: Parent;
        anchor: mod.UIAnchor;
        visible: boolean;
        bgColor: mod.Vector;
        bgAlpha: number;
        bgFill: mod.UIBgFill;
        depth: mod.UIDepth;
        x: number;
        y: number;
        width: number;
        height: number;
        receiver: GlobalReceiver | TeamReceiver | PlayerReceiver;
        uiInputModeWhenVisible: boolean;
    };

    /****** Classes ******/

    abstract class Receiver<T extends mod.Player | mod.Team | undefined> {
        protected _id: string;

        protected _nativeReceiver: T;

        protected _inputModeRequesters: Set<Element> = new Set();

        protected constructor(id: string, receiver: T) {
            this._id = id;
            this._nativeReceiver = receiver;
        }

        /**
         * The ID of the receiver. Used mainly for generating UI Widget names and for debugging purposes.
         */
        public get id(): string {
            return this._id;
        }

        /**
         * The native receiver of the receiver. This is the actual player or team object, not the receiver object.
         */
        public get nativeReceiver(): T {
            return this._nativeReceiver;
        }

        /**
         * Whether input mode is requested for this receiver.
         */
        public get isInputModeRequested(): boolean {
            return this._inputModeRequesters.size > 0;
        }

        /**
         * Adds an element to the input mode requesters.
         * @param element - The element to add.
         */
        public addInputModeRequester(element: Element): void {
            const wasAlreadyRequested = this.isInputModeRequested;
            this._inputModeRequesters.add(element);

            // If input mode was already requested, do nothing (there is obviously at least one requester).
            if (wasAlreadyRequested) return;

            if (this._nativeReceiver) {
                mod.EnableUIInputMode(true, this._nativeReceiver);
            } else {
                mod.EnableUIInputMode(true);
            }
        }

        /**
         * Removes an element from the input mode requesters.
         * @param element - The element to remove.
         */
        public removeInputModeRequester(element: Element): void {
            const wasAlreadyRequested = this.isInputModeRequested;
            this._inputModeRequesters.delete(element);

            // If input mode was not requested, do nothing (there are obviously still no requesters).
            if (!wasAlreadyRequested) return;

            // If input mode is still requested, do nothing (there is still at least one requester).
            if (this.isInputModeRequested) return;

            if (this._nativeReceiver) {
                mod.EnableUIInputMode(false, this._nativeReceiver);
            } else {
                mod.EnableUIInputMode(false);
            }
        }
    }

    /**
     * The global receiver. This is the receiver for all players and teams.
     */
    export class GlobalReceiver extends Receiver<undefined> {
        /**
         * The singleton instance of the global receiver.
         */
        public static readonly instance = new GlobalReceiver();

        private constructor() {
            super('g', undefined);
        }
    }

    /**
     * The team receiver. This is the receiver for a single team.
     */
    export class TeamReceiver extends Receiver<mod.Team> {
        private static _instances = new Map<number, TeamReceiver>();

        private constructor(receiver: mod.Team) {
            const id = mod.GetObjId(receiver);
            super(`t${id}`, receiver);
            TeamReceiver._instances.set(id, this);
        }

        /**
         * Gets or creates the instance of the team receiver for a given team.
         * @param receiver - The team to get the instance for.
         * @returns The instance of the team receiver.
         */
        public static getInstance(receiver: mod.Team): TeamReceiver {
            return TeamReceiver._instances.get(mod.GetObjId(receiver)) ?? new TeamReceiver(receiver);
        }
    }

    /**
     * The player receiver. This is the receiver for a single player.
     */
    export class PlayerReceiver extends Receiver<mod.Player> {
        private static _instances = new Map<number, PlayerReceiver>();

        private constructor(receiver: mod.Player) {
            const id = mod.GetObjId(receiver);
            super(`p${id}`, receiver);
            PlayerReceiver._instances.set(id, this);
        }

        /**
         * Gets or creates the instance of the player receiver for a given player.
         * @param receiver - The player to get the instance for.
         * @returns The instance of the player receiver.
         */
        public static getInstance(receiver: mod.Player): PlayerReceiver {
            return PlayerReceiver._instances.get(mod.GetObjId(receiver)) ?? new PlayerReceiver(receiver);
        }
    }

    /**
     * The base node class. All elements are nodes, adn all nodes are UI widgets.
     */
    export abstract class Node {
        protected readonly _logging: Logging = logging; // Every node has access to the singleton UI logging instance.
        protected _name: string;
        protected _uiWidget: mod.UIWidget;
        protected _receiver: GlobalReceiver | TeamReceiver | PlayerReceiver;

        /**
         * The constructor for a node.
         * @param name - The name of the node.
         * @param uiWidget - The UI widget of the node.
         * @param receiver - The receiver of the node.
         */
        public constructor(
            name: string,
            uiWidget: mod.UIWidget,
            receiver: GlobalReceiver | TeamReceiver | PlayerReceiver
        ) {
            this._name = name;
            this._uiWidget = uiWidget;
            this._receiver = receiver;
        }

        /**
         * The name of the node. This is the name of the UIWidget.
         */
        public get name(): string {
            return this._name;
        }

        /**
         * The UIWidget of the node.
         */
        public get uiWidget(): mod.UIWidget {
            return this._uiWidget;
        }

        /**
         * The receiver of the node.
         */
        public get receiver(): GlobalReceiver | TeamReceiver | PlayerReceiver {
            return this._receiver;
        }
    }

    /**
     * The root node. This is the root of the UI tree for the entire server.
     */
    export class Root extends Node implements Parent {
        /**
         * The singleton instance of the root node.
         */
        public static readonly instance = new Root();

        private _children: Set<Element> = new Set();

        private constructor() {
            super('root', mod.GetUIRoot(), GlobalReceiver.instance);
        }

        /**
         * The children of the root node.
         */
        public get children(): Element[] {
            return Array.from(this._children);
        }

        /**
         * Attaches a child to the root node.
         * @param child - The child to attach.
         */
        public attachChild(child: Element): void {
            this._children.add(child);
        }

        /**
         * Detaches a child from the root node.
         * @param child - The child to detach.
         */
        public detachChild(child: Element): void {
            this._children.delete(child);
        }
    }

    /**
     * The base element class. All elements are nodes, and all nodes are UI widgets.
     */
    export abstract class Element extends Node {
        protected _parent: Parent;
        protected _visible: boolean;
        protected _x: number;
        protected _y: number;
        protected _width: number;
        protected _height: number;
        protected _bgColor: mod.Vector;
        protected _bgAlpha: number;
        protected _bgFill: mod.UIBgFill;
        protected _depth: mod.UIDepth;
        protected _anchor: mod.UIAnchor;
        protected _uiInputModeWhenVisible: boolean;
        protected _deleted: boolean = false;

        /**
         * The constructor for an element.
         * @param params - The parameters for the element.
         */
        public constructor(params: FinalElementParams) {
            super(params.name, mod.FindUIWidgetWithName(params.name) as mod.UIWidget, params.receiver);

            this._parent = params.parent;
            this._visible = params.visible;
            this._x = params.x;
            this._y = params.y;
            this._width = params.width;
            this._height = params.height;
            this._bgColor = params.bgColor;
            this._bgAlpha = params.bgAlpha;
            this._bgFill = params.bgFill;
            this._depth = params.depth;
            this._anchor = params.anchor;
            this._uiInputModeWhenVisible = params.uiInputModeWhenVisible;

            this._parent.attachChild(this);

            if (this._uiInputModeWhenVisible && this._visible) {
                this._receiver.addInputModeRequester(this);
            }
        }

        protected _isDeletedCheck(): boolean {
            if (this._deleted) {
                logging.log(`Element ${this.name} already deleted.`, LogLevel.Warning);
                return true;
            }

            return false;
        }

        /**
         * The parent of the element.
         */
        public get parent(): Parent {
            return this._parent;
        }

        /**
         * Sets the parent of the element.
         * @param parent - The parent to set.
         */
        public set parent(parent: Parent) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetParent(this._uiWidget, parent.uiWidget);

            this._parent.detachChild(this);

            this._parent = parent;

            this._parent.attachChild(this);
        }

        /**
         * Sets the parent of the element. Useful for chaining operations.
         * @param parent - The parent to set.
         * @returns This element instance.
         */
        public setParent(parent: Parent): this {
            this.parent = parent;
            return this;
        }

        /**
         * Whether the element is visible.
         */
        public get visible(): boolean {
            return this._visible;
        }

        /**
         * Sets the visibility of the element.
         * @param visible - The visibility to set.
         */
        public set visible(visible: boolean) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetVisible(this._uiWidget, (this._visible = visible));

            if (!this._uiInputModeWhenVisible) return;

            if (visible) {
                this._receiver.addInputModeRequester(this);
            } else {
                this._receiver.removeInputModeRequester(this);
            }
        }

        /**
         * Sets the visibility of the element. Useful for chaining operations.
         * @param visible - The visibility to set.
         * @returns This element instance.
         */
        public setVisible(visible: boolean): this {
            this.visible = visible;
            return this;
        }

        /**
         * Shows the element.
         * @returns This element instance.
         */
        public show(): this {
            this.visible = true;
            return this;
        }

        /**
         * Hides the element.
         * @returns This element instance.
         */
        public hide(): this {
            this.visible = false;
            return this;
        }

        /**
         * Toggles the visibility of the element.
         * @returns This element instance.
         */
        public toggle(): this {
            this.visible = !this.visible;
            return this;
        }

        /**
         * Whether the element is deleted. This is needed to block all setter operations after the element is deleted
         * but a reference to the element is still in memory and the experience code is still trying to use it.
         */
        public get deleted(): boolean {
            return this._deleted;
        }

        /**
         * Deletes the element. Does not return `this` for chaining because the element is destroyed and no other calls
         * on it should be performed.
         */
        public delete(): void {
            if (this._isDeletedCheck()) return;

            this._deleted = true;

            if (this._uiInputModeWhenVisible) {
                this._receiver.removeInputModeRequester(this);
            }

            this._parent.detachChild(this);

            mod.DeleteUIWidget(this._uiWidget);
        }

        /**
         * The X position of the element.
         */
        public get x(): number {
            return this._x;
        }

        /**
         * Sets the X position of the element.
         * @param x - The X position to set.
         */
        public set x(x: number) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetPosition(this._uiWidget, mod.CreateVector((this._x = x), this.y, 0));
        }

        /**
         * Sets the X position of the element. Useful for chaining operations.
         * @param x - The X position to set.
         * @returns This element instance.
         */
        public setX(x: number): this {
            this.x = x;
            return this;
        }

        /**
         * The Y position of the element.
         */
        public get y(): number {
            return this._y;
        }

        /**
         * Sets the Y position of the element.
         * @param y - The Y position to set.
         */
        public set y(y: number) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetPosition(this._uiWidget, mod.CreateVector(this.x, (this._y = y), 0));
        }

        /**
         * Sets the Y position of the element. Useful for chaining operations.
         * @param y - The Y position to set.
         * @returns This element instance.
         */
        public setY(y: number): this {
            this.y = y;
            return this;
        }

        /**
         * The position of the element.
         */
        public get position(): Position {
            return { x: this._x, y: this._y };
        }

        /**
         * Sets the position of the element.
         * @param params - The position to set.
         */
        public set position(params: Position) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetPosition(this._uiWidget, mod.CreateVector((this._x = params.x), (this._y = params.y), 0));
        }

        /**
         * Sets the position of the element. Useful for chaining operations.
         * @param params - The position to set.
         * @returns This element instance.
         */
        public setPosition(params: Position): this {
            this.position = params;
            return this;
        }

        /**
         * The width of the element.
         */
        public get width(): number {
            return this._width;
        }

        /**
         * Sets the width of the element.
         * @param width - The width to set.
         */
        public set width(width: number) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector((this._width = width), this.height, 0));
        }

        /**
         * Sets the width of the element. Useful for chaining operations.
         * @param width - The width to set.
         * @returns This element instance.
         */
        public setWidth(width: number): this {
            this.width = width;
            return this;
        }

        /**
         * The height of the element.
         */
        public get height(): number {
            return this._height;
        }

        /**
         * Sets the height of the element.
         * @param height - The height to set.
         */
        public set height(height: number) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(this.width, (this._height = height), 0));
        }

        /**
         * Sets the height of the element. Useful for chaining operations.
         * @param height - The height to set.
         * @returns This element instance.
         */
        public setHeight(height: number): this {
            this.height = height;
            return this;
        }

        /**
         * The size of the element.
         */
        public get size(): Size {
            return { width: this._width, height: this._height };
        }

        /**
         * Sets the size of the element.
         * @param params - The size to set.
         */
        public set size(params: Size) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetSize(
                this._uiWidget,
                mod.CreateVector((this._width = params.width), (this._height = params.height), 0)
            );
        }

        /**
         * Sets the size of the element. Useful for chaining operations.
         * @param params - The size to set.
         * @returns This element instance.
         */
        public setSize(params: Size): this {
            this.size = params;
            return this;
        }

        /**
         * The background color of the element.
         */
        public get bgColor(): mod.Vector {
            return this._bgColor;
        }

        /**
         * Sets the background color of the element.
         * @param color - The background color to set.
         */
        public set bgColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetBgColor(this._uiWidget, (this._bgColor = color));
        }

        /**
         * Sets the background color of the element. Useful for chaining operations.
         * @param color - The background color to set.
         * @returns This element instance.
         */
        public setBgColor(color: mod.Vector): this {
            this.bgColor = color;
            return this;
        }

        /**
         * The background alpha of the element.
         */
        public get bgAlpha(): number {
            return this._bgAlpha;
        }

        /**
         * Sets the background alpha of the element.
         * @param alpha - The background alpha to set.
         */
        public set bgAlpha(alpha: number) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetBgAlpha(this._uiWidget, (this._bgAlpha = alpha));
        }

        /**
         * Sets the background alpha of the element. Useful for chaining operations.
         * @param alpha - The background alpha to set.
         * @returns This element instance.
         */
        public setBgAlpha(alpha: number): this {
            this.bgAlpha = alpha;
            return this;
        }

        /**
         * The background fill of the element.
         */
        public get bgFill(): mod.UIBgFill {
            return this._bgFill;
        }

        /**
         * Sets the background fill of the element.
         * @param fill - The background fill to set.
         */
        public set bgFill(fill: mod.UIBgFill) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetBgFill(this._uiWidget, (this._bgFill = fill));
        }

        /**
         * Sets the background fill of the element. Useful for chaining operations.
         * @param fill - The background fill to set.
         * @returns This element instance.
         */
        public setBgFill(fill: mod.UIBgFill): this {
            this.bgFill = fill;
            return this;
        }

        /**
         * The depth of the element.
         */
        public get depth(): mod.UIDepth {
            return this._depth;
        }

        /**
         * Sets the depth of the element.
         * @param depth - The depth to set.
         */
        public set depth(depth: mod.UIDepth) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetDepth(this._uiWidget, (this._depth = depth));
        }

        /**
         * Sets the depth of the element. Useful for chaining operations.
         * @param depth - The depth to set.
         * @returns This element instance.
         */
        public setDepth(depth: mod.UIDepth): this {
            this.depth = depth;
            return this;
        }

        /**
         * The anchor of the element.
         */
        public get anchor(): mod.UIAnchor {
            return this._anchor;
        }

        /**
         * Sets the anchor of the element.
         * @param anchor - The anchor to set.
         */
        public set anchor(anchor: mod.UIAnchor) {
            if (this._isDeletedCheck()) return;

            mod.SetUIWidgetAnchor(this._uiWidget, (this._anchor = anchor));
        }

        /**
         * Sets the anchor of the element. Useful for chaining operations.
         * @param anchor - The anchor to set.
         * @returns This element instance.
         */
        public setAnchor(anchor: mod.UIAnchor): this {
            this.anchor = anchor;
            return this;
        }

        /**
         * Whether the element will request UI input mode to be enabled for its receiver when it becomes visible.
         */
        public get uiInputModeWhenVisible(): boolean {
            return this._uiInputModeWhenVisible;
        }

        /**
         * Sets whether the element will request UI input mode to be enabled for its receiver when it becomes visible.
         * Has an immediate effect on the receiver's input mode state.
         * @param newValue - The new value.
         */
        public set uiInputModeWhenVisible(newValue: boolean) {
            if (this._isDeletedCheck()) return;

            const previousValue = this._uiInputModeWhenVisible;

            if (previousValue === newValue) return;

            this._uiInputModeWhenVisible = newValue;

            // If `uiInputModeWhenVisible` is being enabled and the element is visible...
            if (newValue && this.visible) {
                // ...add the element as an input mode requester.
                this._receiver.addInputModeRequester(this);
            } else {
                // ...remove the element as an input mode requester.
                this._receiver.removeInputModeRequester(this);
            }
        }

        /**
         * Sets whether the element will request UI input mode to be enabled for its receiver when it becomes visible.
         * Has an immediate effect on the receiver's input mode state.
         * Useful for chaining operations.
         * @param newValue - The new value.
         * @returns This element instance.
         */
        public setUiInputModeWhenVisible(newValue: boolean): this {
            this.uiInputModeWhenVisible = newValue;
            return this;
        }
    }

    /****** Constants ******/

    /**
     * Some useful colors.
     */
    export const COLORS = {
        BLACK: mod.CreateVector(0, 0, 0),
        GREY_25: mod.CreateVector(0.25, 0.25, 0.25),
        GREY_50: mod.CreateVector(0.5, 0.5, 0.5),
        GREY_75: mod.CreateVector(0.75, 0.75, 0.75),
        WHITE: mod.CreateVector(1, 1, 1),
        RED: mod.CreateVector(1, 0, 0),
        GREEN: mod.CreateVector(0, 1, 0),
        BLUE: mod.CreateVector(0, 0, 1),
        YELLOW: mod.CreateVector(1, 1, 0),
        PURPLE: mod.CreateVector(1, 0, 1),
        CYAN: mod.CreateVector(0, 1, 1),
        MAGENTA: mod.CreateVector(1, 0, 1),
        BF_GREY_1: mod.CreateVector(0.8353, 0.9216, 0.9765), // #D5EBF9
        BF_GREY_2: mod.CreateVector(0.3294, 0.3686, 0.3882), // #545E63
        BF_GREY_3: mod.CreateVector(0.2118, 0.2235, 0.2353), // #36393C
        BF_GREY_4: mod.CreateVector(0.0314, 0.0431, 0.0431), // #080B0B,
        BF_BLUE_BRIGHT: mod.CreateVector(0.4392, 0.9216, 1.0), // #70EBFF
        BF_BLUE_DARK: mod.CreateVector(0.0745, 0.1843, 0.2471), // #132F3F
        BF_RED_BRIGHT: mod.CreateVector(1.0, 0.5137, 0.3804), // #FF8361
        BF_RED_DARK: mod.CreateVector(0.251, 0.0941, 0.0667), // #401811
        BF_GREEN_BRIGHT: mod.CreateVector(0.6784, 0.9922, 0.5255), // #ADFD86
        BF_GREEN_DARK: mod.CreateVector(0.2784, 0.4471, 0.2118), // #477236
        BF_YELLOW_BRIGHT: mod.CreateVector(1.0, 0.9882, 0.6118), // #FFFC9C
        BF_YELLOW_DARK: mod.CreateVector(0.4431, 0.3765, 0.0), // #716000
    };

    /**
     * The root node. This is the root of the UI tree and the default parent for all elements.
     */
    export const ROOT_NODE = Root.instance;

    /****** Button Registry ******/

    type HandlerData = {
        handler?: ButtonHandler;
        name: string;
    };

    const BUTTONS = new Map<string, Button>();

    function getButtonHandler(button: Button, event: mod.UIButtonEvent): HandlerData {
        if (mod.Equals(event, mod.UIButtonEvent.ButtonDown)) {
            return { handler: button.onClickDown, name: 'onClickDown' };
        }

        if (mod.Equals(event, mod.UIButtonEvent.ButtonUp)) {
            return { handler: button.onClickUp, name: 'onClickUp' };
        }

        if (mod.Equals(event, mod.UIButtonEvent.FocusIn)) {
            return { handler: button.onFocusIn, name: 'onFocusIn' };
        }

        if (mod.Equals(event, mod.UIButtonEvent.FocusOut)) {
            return { handler: button.onFocusOut, name: 'onFocusOut' };
        }

        if (mod.Equals(event, mod.UIButtonEvent.HoverIn)) {
            return { handler: undefined, name: 'onHoverIn' };
        }

        if (mod.Equals(event, mod.UIButtonEvent.HoverOut)) {
            return { handler: undefined, name: 'onHoverOut' };
        }

        return { handler: undefined, name: 'default' };
    }

    /**
     * Handles a button event.
     * @param player - The player who pressed the button.
     * @param widget - The widget that was pressed.
     * @param event - The button event.
     */
    function handleButtonEvent(player: mod.Player, widget: mod.UIWidget, event: mod.UIButtonEvent): void {
        const name = mod.GetUIWidgetName(widget);
        const button = BUTTONS.get(name);

        if (!button) {
            logging.log(`Button ${name} not found.`, LogLevel.Warning);
            return;
        }

        const { handler, name: handlerName } = getButtonHandler(button, event);

        if (!handler) {
            logging.log(`Button ${name} has no ${handlerName} handler.`, LogLevel.Warning);
            return;
        }

        CallbackHandler.invoke(handler, [player], `button handler for widget ${name}`, logging, LogLevel.Error);
    }

    /**
     * Registers a button and returns a function to unregister it.
     * @param name - The name of the button.
     * @param button - The button to register.
     * @returns A function to unregister the button.
     */
    export function registerButton(name: string, button: Button): () => void {
        if (BUTTONS.has(name)) {
            logging.log(`Button ${name} already registered.`, LogLevel.Warning);
            return () => {};
        }

        BUTTONS.set(name, button);

        const unregister = () => {
            BUTTONS.delete(name);
        };

        return unregister;
    }

    Events.OnPlayerUIButtonEvent.subscribe(handleButtonEvent);

    /****** Utils ******/

    let counter: number = 0;

    function isTeam(receiver?: mod.Player | mod.Team): receiver is mod.Team {
        return receiver !== undefined && mod.IsType(receiver, mod.Types.Team);
    }

    function isPlayer(receiver?: mod.Player | mod.Team): receiver is mod.Player {
        return receiver !== undefined && mod.IsType(receiver, mod.Types.Player);
    }

    /**
     * Makes a deterministic name for a widget given its parent and receiver.
     * @param parent - The parent of the widget.
     * @param receiver - The receiver of the widget.
     * @returns The name of the widget.
     */
    export function makeName(parent: Parent, receiver: GlobalReceiver | TeamReceiver | PlayerReceiver): string {
        return `${parent.name}${parent.receiver !== receiver ? `_${receiver.id}` : ''}_${counter++}`;
    }

    /**
     * Delegates properties from a source object to a target object.
     * Creates getters, setters, and setter methods (e.g., setPropertyName) for each property.
     * @param target - The object to add properties to (typically `this`)
     * @param source - The object to delegate to
     * @param properties - Array of property names to delegate
     */
    export function delegateProperties<T extends object, S extends object>(
        target: T,
        source: S,
        properties: readonly string[]
    ): void {
        for (const prop of properties) {
            // Create getter and setter.
            Object.defineProperty(target, prop, {
                get() {
                    return (source as Record<string, unknown>)[prop];
                },
                set(value: unknown) {
                    (source as Record<string, unknown>)[prop] = value;
                },
                enumerable: true,
                configurable: true,
            });

            // Create setter method (e.g., setBaseAlpha).
            const setterMethodName = `set${prop.charAt(0).toUpperCase() + prop.slice(1)}`;

            (target as Record<string, unknown>)[setterMethodName] = function (value: unknown) {
                (source as Record<string, unknown>)[prop] = value;
                return this;
            };
        }
    }

    /**
     * Gets the position from the parameters, given either x/y or position.
     * @param params - The parameters.
     * @returns The position.
     */
    export function getPosition(params: ElementParams): Position {
        return { x: params.x ?? params.position?.x ?? 0, y: params.y ?? params.position?.y ?? 0 };
    }

    /**
     * Gets the size from the parameters, given either width/height or size.
     * @param params - The parameters.
     * @returns The size.
     */
    export function getSize(params: ElementParams): Size {
        return { width: params.width ?? params.size?.width ?? 0, height: params.height ?? params.size?.height ?? 0 };
    }

    /**
     * Gets the receiver from the parameters, given either player, team, or neither.
     * @param parent - The parent of the widget.
     * @param receiverParam - The receiver parameter.
     * @returns The receiver.
     */
    export function getReceiver(
        parent: Parent,
        receiverParam?: mod.Player | mod.Team
    ): GlobalReceiver | TeamReceiver | PlayerReceiver {
        if (!receiverParam) return parent.receiver;

        if (isTeam(receiverParam)) {
            const receiver = TeamReceiver.getInstance(receiverParam);

            if (parent.receiver instanceof TeamReceiver && parent.receiver !== receiver) {
                logging.log('Team receiver mismatch with parent.', LogLevel.Warning);
            }

            if (parent.receiver instanceof PlayerReceiver) {
                logging.log('Parent receiver scope is more narrow.', LogLevel.Warning);
            }

            return receiver;
        }

        if (isPlayer(receiverParam)) {
            const receiver = PlayerReceiver.getInstance(receiverParam);

            if (parent.receiver instanceof PlayerReceiver && parent.receiver !== receiver) {
                logging.log('Player receiver mismatch with parent.', LogLevel.Warning);
            }

            if (
                parent.receiver instanceof TeamReceiver &&
                !mod.Equals(parent.receiver.nativeReceiver, mod.GetTeam(receiverParam))
            ) {
                logging.log('Parent receiver is different team.', LogLevel.Warning);
            }

            return receiver;
        }

        return GlobalReceiver.instance;
    }
}


// --- SOURCE: node_modules\bf6-portal-utils\ui\components\container\index.ts ---


// version: 6.0.1
export class UIContainer extends UI.Element implements UI.Parent {
    protected _children: Set<UI.Element> = new Set();

    /**
     * Creates a new container.
     * @param params - The parameters for the container.
     */
    public constructor(params: UIContainer.Params) {
        const parent = params.parent ?? UI.ROOT_NODE;
        const receiver = UI.getReceiver(parent, params.receiver);
        const name = UI.makeName(parent, receiver);
        const { x, y } = UI.getPosition(params);
        const { width, height } = UI.getSize(params);

        const elementParams: UI.FinalElementParams = {
            name,
            parent,
            visible: params.visible ?? true,
            x,
            y,
            width,
            height,
            anchor: params.anchor ?? mod.UIAnchor.Center,
            bgColor: params.bgColor ?? UI.COLORS.WHITE,
            bgAlpha: params.bgAlpha ?? 0,
            bgFill: params.bgFill ?? mod.UIBgFill.None,
            depth: params.depth ?? mod.UIDepth.AboveGameUI,
            receiver,
            uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
        };

        const args: [
            string, // name
            mod.Vector, // position
            mod.Vector, // size
            mod.UIAnchor, // anchor
            mod.UIWidget, // parent
            boolean, // visible
            number, // padding
            mod.Vector, // bgColor
            number, // bgAlpha
            mod.UIBgFill, // bgFill
            mod.UIDepth, // depth
        ] = [
            name,
            mod.CreateVector(x, y, 0),
            mod.CreateVector(width, height, 0),
            elementParams.anchor,
            parent.uiWidget,
            elementParams.visible,
            0,
            elementParams.bgColor,
            elementParams.bgAlpha,
            elementParams.bgFill,
            elementParams.depth,
        ];

        if (receiver instanceof UI.GlobalReceiver) {
            mod.AddUIContainer(...args);
        } else {
            mod.AddUIContainer(...args, receiver.nativeReceiver);
        }

        super(elementParams);

        for (const childParams of params.childrenParams ?? []) {
            childParams.parent = this;

            new childParams.type(childParams);
        }
    }

    /**
     * The children of the container.
     */
    public get children(): UI.Element[] {
        return Array.from(this._children);
    }

    /**
     * @inheritdoc
     */
    public override delete(): void {
        for (const child of this._children) {
            child.delete();
        }

        super.delete();
    }

    /**
     * Attaches a child to the container.
     * @param child - The child to attach.
     */
    public attachChild(child: UI.Element): void {
        if (this._deleted) return;

        this._children.add(child);
    }

    /**
     * Detaches a child from the container.
     * @param child - The child to detach.
     */
    public detachChild(child: UI.Element): void {
        this._children.delete(child);
    }
}

export namespace UIContainer {
    /**
     * UIContainer children parameters with a 'type' property and the properties required by that element's constructor.
     * @param T - The type of the element.
     * @returns The child parameters.
     */
    export type ChildParams<T extends UI.ElementParams> = T & {
        type: new (params: T) => UI.Element;
    };

    /**
     * The parameters for creating a new container.
     * @param T - The type of the element.
     * @returns The container parameters.
     */
    export type Params = UI.ElementParams & {
        childrenParams?: ChildParams<any>[];
    };
}


// --- SOURCE: node_modules\bf6-portal-utils\ui\components\text\index.ts ---


// version: 6.0.2
export class UIText extends UI.Element {
    protected _message: mod.Message;
    protected _textSize: number;
    protected _textColor: mod.Vector;
    protected _textAlpha: number;
    protected _textAnchor: mod.UIAnchor;
    protected _padding: number;

    /**
     * Creates a new text.
     * @param params - The parameters for the text.
     */
    public constructor(params: UIText.Params) {
        const parent = params.parent ?? UI.ROOT_NODE;
        const receiver = UI.getReceiver(parent, params.receiver);
        const name = UI.makeName(parent, receiver);
        const { x, y } = UI.getPosition(params);
        const { width, height } = UI.getSize(params);
        const padding = params.padding ?? 0;

        const elementParams: UI.FinalElementParams = {
            name,
            parent,
            visible: params.visible ?? true,
            x,
            y,
            width,
            height,
            anchor: params.anchor ?? mod.UIAnchor.Center,
            bgColor: params.bgColor ?? UI.COLORS.WHITE,
            bgAlpha: params.bgAlpha ?? 0,
            bgFill: params.bgFill ?? mod.UIBgFill.None,
            depth: params.depth ?? mod.UIDepth.AboveGameUI,
            receiver,
            uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
        };

        const textSize = params.textSize ?? 36;
        const textColor = params.textColor ?? UI.COLORS.BLACK;
        const textAlpha = params.textAlpha ?? 1;
        const textAnchor = params.textAnchor ?? mod.UIAnchor.Center;

        const args: [
            string, // name
            mod.Vector, // position
            mod.Vector, // size
            mod.UIAnchor, // anchor
            mod.UIWidget, // parent
            boolean, // visible
            number, // padding
            mod.Vector, // bgColor
            number, // bgAlpha
            mod.UIBgFill, // bgFill
            mod.Message, // message
            number, // textSize
            mod.Vector, // textColor
            number, // textAlpha
            mod.UIAnchor, // textAnchor
            mod.UIDepth, // depth
        ] = [
            name,
            mod.CreateVector(x, y, 0),
            mod.CreateVector(width, height, 0),
            elementParams.anchor,
            parent.uiWidget,
            elementParams.visible,
            padding,
            elementParams.bgColor,
            elementParams.bgAlpha,
            elementParams.bgFill,
            params.message,
            textSize,
            textColor,
            textAlpha,
            textAnchor,
            elementParams.depth,
        ];

        if (receiver instanceof UI.GlobalReceiver) {
            mod.AddUIText(...args);
        } else {
            mod.AddUIText(...args, receiver.nativeReceiver);
        }

        super(elementParams);

        this._message = params.message;
        this._textSize = textSize;
        this._textColor = textColor;
        this._textAlpha = textAlpha;
        this._textAnchor = textAnchor;
        this._padding = padding;
    }

    /**
     * The message of the text. This is an opaque type and cannot be unpacked into a string or compared.
     */
    public get message(): mod.Message {
        return this._message;
    }

    /**
     * Sets the message of the text.
     * @param message - The new message.
     */
    public set message(message: mod.Message) {
        if (this._isDeletedCheck()) return;

        mod.SetUITextLabel(this._uiWidget, (this._message = message));
    }

    /**
     * Sets the message of the text. Useful for chaining operations.
     * @param message - The new message.
     * @returns This element instance.
     */
    public setMessage(message: mod.Message): this {
        this.message = message;
        return this;
    }

    /**
     * The alpha of the text.
     */
    public get textAlpha(): number {
        return this._textAlpha;
    }

    /**
     * Sets the alpha of the text.
     * @param alpha - The new alpha.
     */
    public set textAlpha(alpha: number) {
        if (this._isDeletedCheck()) return;

        mod.SetUITextAlpha(this._uiWidget, (this._textAlpha = alpha));
    }

    /**
     * Sets the alpha of the text. Useful for chaining operations.
     * @param alpha - The new alpha.
     * @returns This element instance.
     */
    public setTextAlpha(alpha: number): this {
        this.textAlpha = alpha;
        return this;
    }

    /**
     * The anchor of the text.
     */
    public get textAnchor(): mod.UIAnchor {
        return this._textAnchor;
    }

    /**
     * Sets the anchor of the text.
     * @param anchor - The new anchor.
     */
    public set textAnchor(anchor: mod.UIAnchor) {
        if (this._isDeletedCheck()) return;

        mod.SetUITextAnchor(this._uiWidget, (this._textAnchor = anchor));
    }

    /**
     * Sets the anchor of the text. Useful for chaining operations.
     * @param anchor - The new anchor.
     * @returns This element instance.
     */
    public setTextAnchor(anchor: mod.UIAnchor): this {
        this.textAnchor = anchor;
        return this;
    }

    /**
     * The color of the text.
     */
    public get textColor(): mod.Vector {
        return this._textColor;
    }

    /**
     * Sets the color of the text.
     * @param color - The new color.
     */
    public set textColor(color: mod.Vector) {
        if (this._isDeletedCheck()) return;

        mod.SetUITextColor(this._uiWidget, (this._textColor = color));
    }

    /**
     * Sets the color of the text. Useful for chaining operations.
     * @param color - The new color.
     * @returns This element instance.
     */
    public setTextColor(color: mod.Vector): this {
        this.textColor = color;
        return this;
    }

    /**
     * The size of the text.
     */
    public get textSize(): number {
        return this._textSize;
    }

    /**
     * Sets the size of the text.
     * @param size - The new size.
     */
    public set textSize(size: number) {
        if (this._isDeletedCheck()) return;

        mod.SetUITextSize(this._uiWidget, (this._textSize = size));
    }

    /**
     * Sets the size of the text. Useful for chaining operations.
     * @param size - The new size.
     * @returns This element instance.
     */
    public setTextSize(size: number): this {
        this.textSize = size;
        return this;
    }

    /**
     * The padding around the text.
     */
    public get padding(): number {
        return this._padding;
    }

    /**
     * Sets the padding around the text.
     * @param padding - The new padding.
     */
    public set padding(padding: number) {
        if (this._isDeletedCheck()) return;

        mod.SetUIWidgetPadding(this._uiWidget, (this._padding = padding));
    }

    /**
     * Sets the padding around the text. Useful for chaining operations.
     * @param padding - The new padding.
     * @returns This element instance.
     */
    public setPadding(padding: number): this {
        this.padding = padding;
        return this;
    }
}

export namespace UIText {
    /**
     * The parameters for creating a new text.
     */
    export type Params = UI.ElementParams & {
        message: mod.Message;
        textSize?: number;
        textColor?: mod.Vector;
        textAlpha?: number;
        textAnchor?: mod.UIAnchor;
        padding?: number;
    };
}


// --- SOURCE: node_modules\bf6-portal-utils\ui\components\button\index.ts ---


// version: 7.0.0
export class UIButton extends UI.Element implements UI.Button {
    protected _enabled: boolean;
    protected _baseColor: mod.Vector;
    protected _baseAlpha: number;
    protected _disabledColor: mod.Vector;
    protected _disabledAlpha: number;
    protected _pressedColor: mod.Vector;
    protected _pressedAlpha: number;
    protected _focusedColor: mod.Vector;
    protected _focusedAlpha: number;
    protected _onClickDown?: UI.ButtonHandler;
    protected _onClickUp?: UI.ButtonHandler;
    protected _onFocusIn?: UI.ButtonHandler;
    protected _onFocusOut?: UI.ButtonHandler;
    protected _unregisterAsButton: () => void;

    /**
     * Creates a new button.
     * @param params - The parameters for the button.
     * Note that all colors are multiplied onto `bgColor`, so it is best to leave `bgColor` as its default, which is white.
     * Similarly, alphas are also multiplied onto `bgAlpha`, however only `bgAlpha` will control the alpha of the `bgFill` effect.
     */
    public constructor(params: UIButton.Params) {
        const parent = params.parent ?? UI.ROOT_NODE;
        const receiver = UI.getReceiver(parent, params.receiver);
        const name = UI.makeName(parent, receiver);
        const { x, y } = UI.getPosition(params);
        const { width, height } = UI.getSize(params);

        const elementParams: UI.FinalElementParams = {
            name,
            parent,
            visible: params.visible ?? true,
            x,
            y,
            width,
            height,
            anchor: params.anchor ?? mod.UIAnchor.Center,
            bgColor: params.bgColor ?? UI.COLORS.WHITE,
            bgAlpha: params.bgAlpha ?? 1,
            bgFill: params.bgFill ?? mod.UIBgFill.Solid,
            depth: params.depth ?? mod.UIDepth.AboveGameUI,
            receiver,
            uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
        };

        const enabled = params.enabled ?? true;
        const baseColor = params.baseColor ?? UI.COLORS.BF_GREY_2;
        const baseAlpha = params.baseAlpha ?? 1;
        const disabledColor = params.disabledColor ?? UI.COLORS.BF_GREY_3;
        const disabledAlpha = params.disabledAlpha ?? 1;
        const pressedColor = params.pressedColor ?? UI.COLORS.BF_GREEN_BRIGHT;
        const pressedAlpha = params.pressedAlpha ?? 1;
        const focusedColor = params.focusedColor ?? UI.COLORS.BF_GREY_1;
        const focusedAlpha = params.focusedAlpha ?? 1;

        const args: [
            string, // name
            mod.Vector, // position
            mod.Vector, // size
            mod.UIAnchor, // anchor
            mod.UIWidget, // parent
            boolean, // visible
            number, // padding
            mod.Vector, // bgColor
            number, // bgAlpha
            mod.UIBgFill, // bgFill
            boolean, // enabled
            mod.Vector, // baseColor
            number, // baseAlpha
            mod.Vector, // disabledColor
            number, // disabledAlpha
            mod.Vector, // pressedColor
            number, // pressedAlpha
            mod.Vector, // hoverColor
            number, // hoverAlpha
            mod.Vector, // focusedColor
            number, // focusedAlpha
            mod.UIDepth, // depth
        ] = [
            name,
            mod.CreateVector(x, y, 0),
            mod.CreateVector(width, height, 0),
            elementParams.anchor,
            parent.uiWidget,
            elementParams.visible,
            0,
            elementParams.bgColor,
            elementParams.bgAlpha,
            elementParams.bgFill,
            enabled,
            baseColor,
            baseAlpha,
            disabledColor,
            disabledAlpha,
            pressedColor,
            pressedAlpha,
            focusedColor,
            focusedAlpha,
            focusedColor,
            focusedAlpha,
            elementParams.depth,
        ];

        if (receiver instanceof UI.GlobalReceiver) {
            mod.AddUIButton(...args);
        } else {
            mod.AddUIButton(...args, receiver.nativeReceiver);
        }

        super(elementParams);

        this._enabled = enabled;
        this._baseColor = baseColor;
        this._baseAlpha = baseAlpha;
        this._disabledColor = disabledColor;
        this._disabledAlpha = disabledAlpha;
        this._pressedColor = pressedColor;
        this._pressedAlpha = pressedAlpha;
        this._focusedColor = focusedColor;
        this._focusedAlpha = focusedAlpha;

        if (params.onClickDown) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.ButtonDown, true);
            this._onClickDown = params.onClickDown;
        }

        if (params.onClickUp) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.ButtonUp, true);
            this._onClickUp = params.onClickUp;
        }

        if (params.onFocusIn) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.FocusIn, true);
            this._onFocusIn = params.onFocusIn;
        }

        if (params.onFocusOut) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.FocusOut, true);
            this._onFocusOut = params.onFocusOut;
        }

        this._unregisterAsButton = UI.registerButton(this._name, this);
    }

    /**
     * @inheritdoc
     */
    public override delete(): void {
        this._unregisterAsButton();
        super.delete();
    }

    /**
     * Whether the button is enabled.
     */
    public get enabled(): boolean {
        return this._enabled;
    }

    /**
     * Sets whether the button is enabled.
     * @param enabled - The new enabled state.
     */
    public set enabled(enabled: boolean) {
        if (this._isDeletedCheck()) return;

        mod.SetUIButtonEnabled(this._uiWidget, (this._enabled = enabled));
    }

    /**
     * Sets whether the button is enabled. Useful for chaining operations.
     * @param enabled - The new enabled state.
     * @returns This element instance.
     */
    public setEnabled(enabled: boolean): this {
        this.enabled = enabled;
        return this;
    }

    /**
     * The base color of the button.
     */
    public get baseColor(): mod.Vector {
        return this._baseColor;
    }

    /**
     * Sets the base color of the button.
     * @param color - The new base color.
     */
    public set baseColor(color: mod.Vector) {
        if (this._isDeletedCheck()) return;

        mod.SetUIButtonColorBase(this._uiWidget, (this._baseColor = color));
    }

    /**
     * Sets the base color of the button. Useful for chaining operations.
     * @param color - The new base color.
     * @returns This element instance.
     */
    public setBaseColor(color: mod.Vector): this {
        this.baseColor = color;
        return this;
    }

    /**
     * The base alpha of the button.
     */
    public get baseAlpha(): number {
        return this._baseAlpha;
    }

    /**
     * Sets the base alpha of the button.
     * @param alpha - The new base alpha.
     */
    public set baseAlpha(alpha: number) {
        if (this._isDeletedCheck()) return;

        mod.SetUIButtonAlphaBase(this._uiWidget, (this._baseAlpha = alpha));
    }

    /**
     * Sets the base alpha of the button. Useful for chaining operations.
     * @param alpha - The new base alpha.
     * @returns This element instance.
     */
    public setBaseAlpha(alpha: number): this {
        this.baseAlpha = alpha;
        return this;
    }

    /**
     * The disabled color of the button.
     */
    public get disabledColor(): mod.Vector {
        return this._disabledColor;
    }

    /**
     * Sets the disabled color of the button.
     * @param color - The new disabled color.
     */
    public set disabledColor(color: mod.Vector) {
        if (this._isDeletedCheck()) return;

        mod.SetUIButtonColorDisabled(this._uiWidget, (this._disabledColor = color));
    }

    /**
     * Sets the disabled color of the button. Useful for chaining operations.
     * @param color - The new disabled color.
     * @returns This element instance.
     */
    public setDisabledColor(color: mod.Vector): this {
        this.disabledColor = color;
        return this;
    }

    /**
     * The disabled alpha of the button.
     */
    public get disabledAlpha(): number {
        return this._disabledAlpha;
    }

    /**
     * Sets the disabled alpha of the button.
     * @param alpha - The new disabled alpha.
     */
    public set disabledAlpha(alpha: number) {
        if (this._isDeletedCheck()) return;

        mod.SetUIButtonAlphaDisabled(this._uiWidget, (this._disabledAlpha = alpha));
    }

    /**
     * Sets the disabled alpha of the button. Useful for chaining operations.
     * @param alpha - The new disabled alpha.
     * @returns This element instance.
     */
    public setDisabledAlpha(alpha: number): this {
        this.disabledAlpha = alpha;
        return this;
    }

    /**
     * The pressed color of the button.
     */
    public get pressedColor(): mod.Vector {
        return this._pressedColor;
    }

    /**
     * Sets the pressed color of the button.
     * @param color - The new pressed color.
     */
    public set pressedColor(color: mod.Vector) {
        if (this._isDeletedCheck()) return;

        mod.SetUIButtonColorPressed(this._uiWidget, (this._pressedColor = color));
    }

    /**
     * Sets the pressed color of the button. Useful for chaining operations.
     * @param color - The new pressed color.
     * @returns This element instance.
     */
    public setColorPressed(color: mod.Vector): this {
        this.pressedColor = color;
        return this;
    }

    /**
     * The pressed alpha of the button.
     */
    public get pressedAlpha(): number {
        return this._pressedAlpha;
    }

    /**
     * Sets the pressed alpha of the button.
     * @param alpha - The new pressed alpha.
     */
    public set pressedAlpha(alpha: number) {
        if (this._isDeletedCheck()) return;

        mod.SetUIButtonAlphaPressed(this._uiWidget, (this._pressedAlpha = alpha));
    }

    /**
     * Sets the pressed alpha of the button. Useful for chaining operations.
     * @param alpha - The new pressed alpha.
     * @returns This element instance.
     */
    public setPressedAlpha(alpha: number): this {
        this.pressedAlpha = alpha;
        return this;
    }

    /**
     * The focused color of the button.
     */
    public get focusedColor(): mod.Vector {
        return this._focusedColor;
    }

    /**
     * Sets the focused color of the button.
     * @param color - The new focused color.
     */
    public set focusedColor(color: mod.Vector) {
        if (this._isDeletedCheck()) return;

        mod.SetUIButtonColorFocused(this._uiWidget, (this._focusedColor = color));
    }

    /**
     * Sets the focused color of the button. Useful for chaining operations.
     * @param color - The new focused color.
     * @returns This element instance.
     */
    public setFocusedColor(color: mod.Vector): this {
        this.focusedColor = color;
        return this;
    }

    /**
     * The focused alpha of the button.
     */
    public get focusedAlpha(): number {
        return this._focusedAlpha;
    }

    /**
     * Sets the focused alpha of the button.
     * @param alpha - The new focused alpha.
     */
    public set focusedAlpha(alpha: number) {
        if (this._isDeletedCheck()) return;

        mod.SetUIButtonAlphaFocused(this._uiWidget, (this._focusedAlpha = alpha));
    }

    /**
     * Sets the focused alpha of the button. Useful for chaining operations.
     * @param alpha - The new focused alpha.
     * @returns This element instance.
     */
    public setFocusedAlpha(alpha: number): this {
        this.focusedAlpha = alpha;
        return this;
    }

    /**
     * The click down handler of the button.
     */
    public get onClickDown(): UI.ButtonHandler | undefined {
        return this._onClickDown;
    }

    /**
     * Sets the click down handler of the button.
     * @param onClickDown - The new click down handler.
     */
    public set onClickDown(onClickDown: UI.ButtonHandler | undefined) {
        if (this._isDeletedCheck()) return;

        if (onClickDown && !this._onClickDown) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.ButtonDown, true);
        } else if (!onClickDown && this._onClickDown) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.ButtonDown, false);
        }

        this._onClickDown = onClickDown;
    }

    /**
     * Sets the click handler of the button. Useful for chaining operations.
     * @param onClick - The new click handler.
     * @returns This element instance.
     */
    public setOnClickDown(onClickDown?: UI.ButtonHandler): this {
        this.onClickDown = onClickDown;
        return this;
    }

    /**
     * The click up handler of the button.
     */
    public get onClickUp(): UI.ButtonHandler | undefined {
        return this._onClickUp;
    }

    /**
     * Sets the click up handler of the button.
     * @param onClickUp - The new click up handler.
     */
    public set onClickUp(onClickUp: UI.ButtonHandler | undefined) {
        if (this._isDeletedCheck()) return;

        if (onClickUp && !this._onClickUp) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.ButtonUp, true);
        } else if (!onClickUp && this._onClickUp) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.ButtonUp, false);
        }

        this._onClickUp = onClickUp;
    }

    /**
     * Sets the click handler of the button. Useful for chaining operations.
     * @param onClickUp - The new click up handler.
     * @returns This element instance.
     */
    public setOnClickUp(onClickUp?: UI.ButtonHandler): this {
        this.onClickUp = onClickUp;
        return this;
    }

    /**
     * The focus in handler of the button.
     */
    public get onFocusIn(): UI.ButtonHandler | undefined {
        return this._onFocusIn;
    }

    /**
     * Sets the focus in handler of the button.
     * @param onFocusIn - The new focus in handler.
     */
    public set onFocusIn(onFocusIn: UI.ButtonHandler | undefined) {
        if (this._isDeletedCheck()) return;

        if (onFocusIn && !this._onFocusIn) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.FocusIn, true);
        } else if (!onFocusIn && this._onFocusIn) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.FocusIn, false);
        }

        this._onFocusIn = onFocusIn;
    }

    /**
     * Sets the focus in handler of the button. Useful for chaining operations.
     * @param onFocusIn - The new focus in handler.
     * @returns This element instance.
     */
    public setOnFocusIn(onFocusIn?: UI.ButtonHandler): this {
        this.onFocusIn = onFocusIn;
        return this;
    }

    /**
     * The focus out handler of the button.
     */
    public get onFocusOut(): UI.ButtonHandler | undefined {
        return this._onFocusOut;
    }

    /**
     * Sets the focus out handler of the button.
     * @param onFocusOut - The new focus out handler.
     */
    public set onFocusOut(onFocusOut: UI.ButtonHandler | undefined) {
        if (this._isDeletedCheck()) return;

        if (onFocusOut && !this._onFocusOut) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.FocusOut, true);
        } else if (!onFocusOut && this._onFocusOut) {
            mod.EnableUIButtonEvent(this._uiWidget, mod.UIButtonEvent.FocusOut, false);
        }

        this._onFocusOut = onFocusOut;
    }

    /**
     * Sets the focus out handler of the button. Useful for chaining operations.
     * @param onFocusOut - The new focus out handler.
     * @returns This element instance.
     */
    public setOnFocusOut(onFocusOut?: UI.ButtonHandler): this {
        this.onFocusOut = onFocusOut;
        return this;
    }
}

export namespace UIButton {
    /**
     * The parameters for creating a new button.
     */
    export type Params = UI.ElementParams & {
        enabled?: boolean;
        baseColor?: mod.Vector;
        baseAlpha?: number;
        disabledColor?: mod.Vector;
        disabledAlpha?: number;
        pressedColor?: mod.Vector;
        pressedAlpha?: number;
        focusedColor?: mod.Vector;
        focusedAlpha?: number;
        onClickDown?: UI.ButtonHandler;
        onClickUp?: UI.ButtonHandler;
        onFocusIn?: UI.ButtonHandler;
        onFocusOut?: UI.ButtonHandler;
    };
}


// --- SOURCE: node_modules\bf6-portal-utils\ui\components\content-button\index.ts ---



/**
 * Base class for buttons that contain content elements (Text, Image, etc.).
 * Handles the common pattern of wrapping a UIButton and content element in a UIContainer.
 * @template TContent - The type of the content element (Text, Image, etc.)
 * @version 7.0.0
 */
export abstract class UIContentButton<TContent extends UI.Element> extends UI.Element {
    protected _padding: number;

    protected _button: UIButton;

    protected _content: TContent;

    // UIButton properties (delegated via delegateProperties).
    declare public baseColor: mod.Vector;
    declare public baseAlpha: number;
    declare public disabledColor: mod.Vector;
    declare public disabledAlpha: number;
    declare public pressedColor: mod.Vector;
    declare public pressedAlpha: number;
    declare public focusedColor: mod.Vector;
    declare public focusedAlpha: number;
    declare public onClickDown?: UI.ButtonHandler;
    declare public onClickUp?: UI.ButtonHandler;
    declare public onFocusIn?: UI.ButtonHandler;
    declare public onFocusOut?: UI.ButtonHandler;

    // UIButton setter methods (delegated via delegateProperties).
    declare public setBaseColor: (color: mod.Vector) => this;
    declare public setBaseAlpha: (alpha: number) => this;
    declare public setDisabledColor: (color: mod.Vector) => this;
    declare public setDisabledAlpha: (alpha: number) => this;
    declare public setPressedColor: (color: mod.Vector) => this;
    declare public setPressedAlpha: (alpha: number) => this;
    declare public setFocusedColor: (color: mod.Vector) => this;
    declare public setFocusedAlpha: (alpha: number) => this;
    declare public setOnClickDown: (onClickDown?: UI.ButtonHandler) => this;
    declare public setOnClickUp: (onClickUp?: UI.ButtonHandler) => this;
    declare public setOnFocusIn: (onFocusIn?: UI.ButtonHandler) => this;
    declare public setOnFocusOut: (onFocusOut?: UI.ButtonHandler) => this;

    /**
     * Creates a new content button.
     * @param params - The parameters for the content button.
     * @param createContent - A function to create the content element.
     * @param contentProperties - The properties to delegate from the content element.
     */
    protected constructor(
        params: UIContentButton.Params,
        createContent: (parent: UI.Parent, width: number, height: number) => TContent,
        contentProperties: readonly string[]
    ) {
        const parent = params.parent ?? UI.ROOT_NODE;
        const receiver = UI.getReceiver(parent, params.receiver);
        const name = UI.makeName(parent, receiver);
        const { x, y } = UI.getPosition(params);
        const { width, height } = UI.getSize(params);
        const depth = params.depth ?? mod.UIDepth.AboveGameUI;
        const padding = params.padding ?? 0;

        const containerElementParams: UI.FinalElementParams = {
            name,
            parent,
            visible: params.visible ?? true,
            x,
            y,
            width,
            height,
            anchor: params.anchor ?? mod.UIAnchor.Center,
            bgColor: UI.COLORS.WHITE,
            bgAlpha: 0,
            bgFill: mod.UIBgFill.None,
            depth,
            receiver,
            uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
        };

        const containerArgs: [
            string, // name
            mod.Vector, // position
            mod.Vector, // size
            mod.UIAnchor, // anchor
            mod.UIWidget, // parent
            boolean, // visible
            number, // padding
            mod.Vector, // bgColor
            number, // bgAlpha
            mod.UIBgFill, // bgFill
            mod.UIDepth, // depth
        ] = [
            name,
            mod.CreateVector(x, y, 0),
            mod.CreateVector(width, height, 0),
            containerElementParams.anchor,
            parent.uiWidget,
            containerElementParams.visible,
            padding,
            containerElementParams.bgColor,
            containerElementParams.bgAlpha,
            containerElementParams.bgFill,
            containerElementParams.depth,
        ];

        if (receiver instanceof UI.GlobalReceiver) {
            mod.AddUIContainer(...containerArgs);
        } else {
            mod.AddUIContainer(...containerArgs, receiver.nativeReceiver);
        }

        super(containerElementParams);

        this._padding = padding;

        // Mock parent needed to allow proper wiring of the button and content elements, and we do not want `this` to
        // need to expose `children`, `attachChild`, and `detachChild`.
        const mockParent: UI.Parent = {
            name: this._name,
            uiWidget: this._uiWidget,
            receiver: this._receiver,
            children: [],
            attachChild(child: UI.Element): void {},
            detachChild(child: UI.Element): void {},
        };

        // Defaults will from from `UIButton` constructor.
        const buttonParams: UIButton.Params = {
            parent: mockParent,
            width,
            height,
            bgColor: params.bgColor,
            bgAlpha: params.bgAlpha,
            bgFill: params.bgFill,
            enabled: params.enabled,
            baseColor: params.baseColor,
            baseAlpha: params.baseAlpha,
            disabledColor: params.disabledColor,
            disabledAlpha: params.disabledAlpha,
            pressedColor: params.pressedColor,
            pressedAlpha: params.pressedAlpha,
            focusedColor: params.focusedColor,
            focusedAlpha: params.focusedAlpha,
            depth,
            onClickDown: params.onClickDown,
            onClickUp: params.onClickUp,
            onFocusIn: params.onFocusIn,
            onFocusOut: params.onFocusOut,
        };

        this._button = new UIButton(buttonParams);

        const widthNetOfPadding = Math.max(0, width - padding * 2);
        const heightNetOfPadding = Math.max(0, height - padding * 2);

        this._content = createContent(mockParent, widthNetOfPadding, heightNetOfPadding);

        // Delegate UIButton properties.
        UI.delegateProperties(this, this._button, [
            'bgColor',
            'bgAlpha',
            'bgFill',
            'baseColor',
            'baseAlpha',
            'disabledColor',
            'disabledAlpha',
            'pressedColor',
            'pressedAlpha',
            'focusedAlpha',
            'focusedColor',
            'onClickDown',
            'onClickUp',
            'onFocusIn',
            'onFocusOut',
        ]);

        // Delegate content properties.
        UI.delegateProperties(this, this._content, contentProperties);
    }

    /**
     * @inheritdoc
     */
    public override delete(): void {
        this._button.delete();
        this._content.delete();

        super.delete();
    }

    /**
     * @inheritdoc
     */
    public override get width(): number {
        return this._button.width;
    }

    /**
     * @inheritdoc
     */
    public override set width(width: number) {
        if (this._isDeletedCheck()) return;

        mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(width, this.height, 0));
        this._button.setWidth(width);
        this._content.setWidth(Math.max(0, width - this._padding * 2));
    }

    /**
     * @inheritdoc
     */
    public override setWidth(width: number): this {
        this.width = width;
        return this;
    }

    /**
     * @inheritdoc
     */
    public override get height(): number {
        return this._button.height;
    }

    /**
     * @inheritdoc
     */
    public override set height(height: number) {
        if (this._isDeletedCheck()) return;

        mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(this.width, height, 0));
        this._button.setHeight(height);
        this._content.setHeight(Math.max(0, height - this._padding * 2));
    }

    /**
     * @inheritdoc
     */
    public override setHeight(height: number): this {
        this.height = height;
        return this;
    }

    /**
     * @inheritdoc
     */
    public override get size(): UI.Size {
        return { width: this._button.width, height: this._button.height };
    }

    /**
     * @inheritdoc
     */
    public override set size(params: UI.Size) {
        if (this._isDeletedCheck()) return;

        mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(params.width, params.height, 0));
        this._button.setSize(params);

        this._content.setSize({
            width: Math.max(0, params.width - this._padding * 2),
            height: Math.max(0, params.height - this._padding * 2),
        });
    }

    /**
     * @inheritdoc
     */
    public override setSize(params: UI.Size): this {
        this.size = params;
        return this;
    }

    /**
     * Whether the button is enabled.
     */
    public get enabled(): boolean {
        return this._button.enabled;
    }

    /**
     * Sets whether the button is enabled.
     * @param enabled - The new enabled state.
     */
    public set enabled(enabled: boolean) {
        if (this._isDeletedCheck()) return;

        this._button.enabled = enabled;
    }

    /**
     * Sets whether the button is enabled. Useful for chaining operations.
     * @param enabled - The new enabled state.
     * @returns This element instance.
     */
    public setEnabled(enabled: boolean): this {
        this.enabled = enabled;
        return this;
    }

    /**
     * The padding of the content button.
     */
    public get padding(): number {
        return this._padding;
    }

    /**
     * Sets the padding of the content button.
     * @param padding - The new padding.
     */
    public set padding(padding: number) {
        if (this._isDeletedCheck()) return;

        mod.SetUIWidgetPadding(this._uiWidget, (this._padding = padding));
    }

    /**
     * Sets the padding of the content button. Useful for chaining operations.
     * @param padding - The new padding.
     * @returns This element instance.
     */
    public setPadding(padding: number): this {
        this.padding = padding;
        return this;
    }
}

export namespace UIContentButton {
    /**
     * The parameters for creating a new content button.
     */
    export type Params = UIButton.Params & {
        padding?: number;
    };
}


// --- SOURCE: node_modules\bf6-portal-utils\ui\components\text-button\index.ts ---





// version: 6.0.2
export class UITextButton extends UIContentButton<UIText> {
    // UIText properties (delegated via delegateProperties)
    declare public message: mod.Message;
    declare public textAnchor: mod.UIAnchor;
    declare public textSize: number;

    // UIText setter methods (delegated via delegateProperties)
    declare public setMessage: (message: mod.Message) => this;
    declare public setTextAnchor: (anchor: mod.UIAnchor) => this;
    declare public setTextSize: (size: number) => this;

    protected _textDisabledColor: mod.Vector;

    protected _textDisabledAlpha: number;

    /**
     * Creates a new text button.
     * @param params - The parameters for the text button.
     */
    public constructor(params: UITextButton.Params) {
        const createContent = (parent: UI.Parent, width: number, height: number): UIText => {
            const textParams: UIText.Params = {
                parent,
                width,
                height,
                message: params.message,
                textSize: params.textSize,
                textColor: params.textColor,
                textAlpha: params.textAlpha,
                textAnchor: params.textAnchor,
                depth: params.depth,
            };

            return new UIText(textParams);
        };

        super(params, createContent, ['message', 'textSize', 'textAnchor'] as readonly string[]);

        this._textDisabledColor = params.textDisabledColor ?? UI.COLORS.BF_GREY_2;
        this._textDisabledAlpha = params.textDisabledAlpha ?? 1;

        if (!this._button.enabled) {
            this._setContentEnabled(false);
        }
    }

    private _setContentEnabled(enabled: boolean): void {
        if (enabled) {
            mod.SetUITextColor(this._content.uiWidget, this._content.textColor);
            mod.SetUITextAlpha(this._content.uiWidget, this._content.textAlpha);
        } else {
            mod.SetUITextColor(this._content.uiWidget, this._textDisabledColor);
            mod.SetUITextAlpha(this._content.uiWidget, this._textDisabledAlpha);
        }
    }

    /**
     * @inheritdoc
     */
    public override get enabled(): boolean {
        return this._button.enabled;
    }

    /**
     * @inheritdoc
     */
    public override set enabled(enabled: boolean) {
        if (this._isDeletedCheck()) return;

        this._button.enabled = enabled;
        this._setContentEnabled(enabled);
    }

    /**
     * @inheritdoc
     */
    public override setEnabled(enabled: boolean): this {
        this.enabled = enabled;
        return this;
    }

    /**
     * The color of the text when the button is enabled.
     */
    public get textColor(): mod.Vector {
        return this._content.textColor;
    }

    /**
     * Sets the color of the text when the button is enabled.
     * @param color - The new color.
     */
    public set textColor(color: mod.Vector) {
        if (this._isDeletedCheck()) return;

        this._content.textColor = color;

        if (this._button.enabled) {
            mod.SetUITextColor(this._content.uiWidget, color);
        }
    }

    /**
     * Sets the color of the text when the button is enabled. Useful for chaining operations.
     * @param color - The new color.
     * @returns This element instance.
     */
    public setTextColor(color: mod.Vector): this {
        this.textColor = color;
        return this;
    }

    /**
     * The alpha of the text when the button is enabled.
     */
    public get textAlpha(): number {
        return this._content.textAlpha;
    }

    /**
     * Sets the alpha of the text when the button is enabled.
     * @param alpha - The new alpha.
     */
    public set textAlpha(alpha: number) {
        if (this._isDeletedCheck()) return;

        this._content.textAlpha = alpha;

        if (this._button.enabled) {
            mod.SetUITextAlpha(this._content.uiWidget, alpha);
        }
    }

    /**
     * Sets the alpha of the text when the button is enabled. Useful for chaining operations.
     * @param alpha - The new alpha.
     * @returns This element instance.
     */
    public setTextAlpha(alpha: number): this {
        this.textAlpha = alpha;
        return this;
    }

    /**
     * The color of the text when the button is disabled.
     */
    public get textDisabledColor(): mod.Vector {
        return this._textDisabledColor;
    }

    /**
     * Sets the color of the text when the button is disabled.
     * @param color - The new color.
     */
    public set textDisabledColor(color: mod.Vector) {
        if (this._isDeletedCheck()) return;

        this._textDisabledColor = color;

        if (!this._button.enabled) {
            mod.SetUITextColor(this._content.uiWidget, color);
        }
    }

    /**
     * Sets the color of the text when the button is disabled. Useful for chaining operations.
     * @param color - The new color.
     * @returns This element instance.
     */
    public setTextDisabledColor(color: mod.Vector): this {
        this.textDisabledColor = color;
        return this;
    }

    /**
     * The alpha of the text when the button is disabled.
     */
    public get textDisabledAlpha(): number {
        return this._textDisabledAlpha;
    }

    /**
     * Sets the alpha of the text when the button is disabled.
     * @param alpha - The new alpha.
     */
    public set textDisabledAlpha(alpha: number) {
        if (this._isDeletedCheck()) return;

        this._textDisabledAlpha = alpha;

        if (!this._button.enabled) {
            mod.SetUITextAlpha(this._content.uiWidget, alpha);
        }
    }

    /**
     * Sets the alpha of the text when the button is disabled. Useful for chaining operations.
     * @param alpha - The new alpha.
     * @returns This element instance.
     */
    public setTextDisabledAlpha(alpha: number): this {
        this.textDisabledAlpha = alpha;
        return this;
    }
}

export namespace UITextButton {
    /**
     * The parameters for creating a new text button.
     */
    export type Params = UIButton.Params &
        UIText.Params & {
            textDisabledColor?: mod.Vector;
            textDisabledAlpha?: number;
        };
}


// --- SOURCE: node_modules\bf6-portal-utils\multi-click-detector\index.ts ---




// version 3.0.1
export class MultiClickDetector {
    private static _logging = new Logging('MCD');

    private static _detectors = new Map<number, { enabled: boolean; detectors: Set<MultiClickDetector> }>();

    /**
     * Attaches a logger and defines a minimum log level and whether to include the runtime error in the log.
     * @param log - The logger function to use. Pass undefined to disable logging.
     * @param logLevel - The minimum log level to use.
     * @param includeError - Whether to include the runtime error in the log.
     */
    public static setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        this._logging.setLogging(log, logLevel, includeError);
    }

    static {
        Events.OngoingPlayer.subscribe(MultiClickDetector._handleOngoingPlayer);
        Events.OnPlayerDeployed.subscribe(MultiClickDetector._handlePlayerDeployed);
        Events.OnPlayerUndeploy.subscribe(MultiClickDetector._handlePlayerUndeployed);
        Events.OnPlayerLeaveGame.subscribe(MultiClickDetector._handlePlayerLeaveGame);
    }

    private static _handleOngoingPlayer(player: mod.Player): void {
        const playerState = MultiClickDetector._detectors.get(mod.GetObjId(player));

        if (!playerState) return;

        if (!playerState.enabled) return;

        for (const detector of playerState.detectors) {
            detector._handleOngoing();
        }
    }

    private static _handlePlayerDeployed(player: mod.Player): void {
        const playerState = MultiClickDetector._detectors.get(mod.GetObjId(player));

        if (!playerState) return;

        playerState.enabled = true;
    }

    private static _handlePlayerUndeployed(player: mod.Player): void {
        const playerState = MultiClickDetector._detectors.get(mod.GetObjId(player));

        if (!playerState) return;

        playerState.enabled = false;
    }

    private static _handlePlayerLeaveGame(playerId: number): void {
        MultiClickDetector._detectors.delete(playerId);

        MultiClickDetector._logging.log(
            `Player ${playerId} left the game: multi-click detectors cleaned up.`,
            Logging.LogLevel.Warning
        );
    }

    private static _isPlayerDeployed(player: mod.Player): boolean {
        // Need to try/catch since certain soldier state checks error for players that are not deployed.
        try {
            return (
                mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive) ||
                mod.GetSoldierState(player, mod.SoldierStateBool.IsManDown)
            );
        } catch (error) {
            return false;
        }
    }

    /**
     * Creates a new multi-click detector with specific options.
     * @param player - The player to detect multi-click sequences for.
     * @param callback - The callback to call when a multi-click sequence is detected.
     * @param options - The options for the multi-click detector.
     */
    public constructor(player: mod.Player, callback: () => Promise<void> | void, options?: MultiClickDetector.Options) {
        this._playerId = mod.GetObjId(player);

        this._player = player;
        this._callback = callback;

        if (!MultiClickDetector._detectors.has(this._playerId)) {
            MultiClickDetector._detectors.set(this._playerId, {
                enabled: MultiClickDetector._isPlayerDeployed(player),
                detectors: new Set(),
            });
        }

        MultiClickDetector._detectors.get(this._playerId)!.detectors.add(this);

        if (!options) return;

        this._soldierState = options.soldierState ?? this._soldierState;
        this._window = options.windowMs ?? this._window;
        this._requiredClicks = options.requiredClicks ?? this._requiredClicks;
    }

    private _player: mod.Player;

    private _playerId: number;

    private _enabled = true;

    private _lastState = false;

    private _clickCount = 0;

    private _sequenceStartTime = 0;

    private _callback: () => Promise<void> | void;

    private _soldierState = mod.SoldierStateBool.IsInteracting;

    private _window = 1_000; // Time window in milliseconds for a valid multi-click sequence.

    private _requiredClicks = 3; // Number of clicks required to trigger a multi-click sequence.

    private _handleOngoing(): void {
        if (!this._enabled) return;

        const currentState = mod.GetSoldierState(this._player, this._soldierState);

        if (currentState === this._lastState) return; // Fast exit for the vast majority of ticks.

        this._lastState = currentState;

        if (!currentState) return; // Return on a falling edge.

        const now = Date.now();

        // If the time window has passed, reset the sequence.
        if (this._clickCount > 0 && now - this._sequenceStartTime > this._window) {
            this._clickCount = 0;
        }

        if (this._clickCount === 0) {
            this._sequenceStartTime = now;
            this._clickCount = 1;

            return;
        }

        if (++this._clickCount !== this._requiredClicks) return;

        this._clickCount = 0; // Reset for next unique sequence.

        CallbackHandler.invokeNoArgs(
            this._callback,
            `player ${this._playerId}`,
            MultiClickDetector._logging,
            Logging.LogLevel.Error
        );

        if (MultiClickDetector._logging.willLog(Logging.LogLevel.Info)) {
            MultiClickDetector._logging.log(
                `Player ${this._playerId} performed multi-click sequence.`,
                Logging.LogLevel.Info
            );
        }
    }

    public enable(): void {
        this._enabled = true;
    }

    public disable(): void {
        this._enabled = false;
    }

    /**
     * Destroys the multi-click detector.
     */
    public destroy(): void {
        const playerState = MultiClickDetector._detectors.get(this._playerId);

        if (!playerState) return;

        playerState.detectors.delete(this);

        if (playerState.detectors.size === 0) {
            MultiClickDetector._detectors.delete(this._playerId);
        }
    }
}

export namespace MultiClickDetector {
    /**
     * The options for the multi-click detector.
     */
    export interface Options {
        /**
         * The soldier state boolean to use for the multi-click detector.
         */
        soldierState?: mod.SoldierStateBool;
        /**
         * The window in milliseconds for a valid multi-click sequence.
         */
        windowMs?: number;
        /**
         * The number of clicks required to trigger a multi-click sequence.
         */
        requiredClicks?: number;
    }

    /**
     * The log levels.
     */
    export const LogLevel = Logging.LogLevel;
}


// --- SOURCE: tools\soundboard\BF6_SFX\src\lib\debug\telemetry.ts ---
/**
 * @purpose In-mod telemetry emitter — structured console.log lines the external tailer parses.
 *
 * A sandboxed Portal mod's only output channel is console.log -> PortalLog.txt (when "Host Locally").
 * Pairs with ../../../../PortalSDK/_DevTools/debug-bridge/tail_portal_log.py. Keep [TLM] throttled.
 */

type Val = number | string | boolean;

function fmt(obj: Record<string, Val>): string {
  const parts: string[] = [];
  for (const k in obj) {
    const v = obj[k];
    parts.push(typeof v === "string" && /\s/.test(v) ? `${k}="${v}"` : `${k}=${v}`);
  }
  return parts.join(" ");
}

export const Tlm = {
  /** Periodic numeric sample, e.g. Tlm.sample({ tickMs, zCount, retargetMs }). Throttle this. */
  sample(fields: Record<string, Val>): void {
    console.log("[TLM] " + fmt(fields));
  },

  /** Discrete event, e.g. Tlm.event("hitRegistered", { rayId, dist, ms }). */
  event(name: string, fields: Record<string, Val> = {}): void {
    console.log("[EVT] " + fmt({ name, ...fields }));
  },

  /** Debug-tunable parameter state (mirror Debug Console values here). */
  param(name: string, val: number, min: number, max: number, step: number): void {
    console.log(`[PARAM] name=${name} val=${val} min=${min} max=${max} step=${step}`);
  },
};

/**
 * Fixed-cadence throttle so per-tick code can emit without flooding the log.
 * Inject a "now in seconds" supplier (e.g. mod.GetMatchTimeElapsed()) to stay engine-agnostic.
 *   const t = new Throttle(0.25);                  // 4 Hz
 *   if (t.ready(now)) Tlm.sample({ ... });
 */
export class Throttle {
  private next = 0;
  constructor(private periodSec: number) {}
  ready(nowSec: number): boolean {
    if (nowSec >= this.next) {
      this.next = nowSec + this.periodSec;
      return true;
    }
    return false;
  }
}


// --- SOURCE: tools\soundboard\BF6_SFX\src\lib\debug\console.ts ---
/**
 * @purpose Debug Console — registry of live-tunable params, mirrored to telemetry.
 *
 * The value-tuning core of the debug loop: define a knob (min/max/step/value), read it in gameplay
 * code, adjust it live in-game, and every change is emitted as a [PARAM] line so the external tailer
 * sees the current value. The on-screen overlay + input bindings are built later (research-gated) on
 * top of this registry — see ../../../../PortalSDK/_Research/guides/ui-events-audio-vfx.md.
 */


export interface TunableSpec {
  min: number;
  max: number;
  step: number;
  value: number;
}

export class DebugConsole {
  private params = new Map<string, TunableSpec>();

  /** Register a tunable knob and emit its initial state. */
  define(name: string, spec: TunableSpec): void {
    this.params.set(name, { ...spec });
    Tlm.param(name, spec.value, spec.min, spec.max, spec.step);
  }

  /** Current value of a knob (throws if undefined — fail loud during dev). */
  get(name: string): number {
    const p = this.params.get(name);
    if (!p) throw new Error("unknown debug param: " + name);
    return p.value;
  }

  /** Set a clamped value and emit the new [PARAM] state. */
  set(name: string, value: number): void {
    const p = this.params.get(name);
    if (!p) throw new Error("unknown debug param: " + name);
    p.value = Math.max(p.min, Math.min(p.max, value));
    Tlm.param(name, p.value, p.min, p.max, p.step);
  }

  /** Nudge a knob by ±1 step (for the eventual up/down input bindings). */
  adjust(name: string, dir: 1 | -1): void {
    const p = this.params.get(name);
    if (!p) return;
    this.set(name, p.value + dir * p.step);
  }

  names(): string[] {
    return [...this.params.keys()];
  }

  // TODO(research-gated): on-screen overlay (AddUIContainer + cached AddUIText rows refreshed from
  // OngoingGlobal) and input binding (OnPlayerUIButtonEvent / key detection) to select + adjust knobs
  // live. Read _Research/guides/ui-events-audio-vfx.md (§ live debug overlay) before building.
}

/** Shared singleton console for an experience. */
export const debug = new DebugConsole();


// --- SOURCE: tools\soundboard\BF6_SFX\src\lib\debug\callcount.ts ---
/**
 * @purpose Native-call instrumentation — count every mod.* call by category and emit per-window
 * telemetry, so we can SEE call volume vs zombie count (the #1 thing that lagged the old mod).
 *
 * Usage (bring in instrument + calls from this module, then):
 *   const M = instrument(mod);        // use M.* instead of mod.* everywhere in hot paths
 *   // ... gameplay calls M.AISetTarget(...), M.GetObjectPosition(...), etc.
 *   // once per second from OngoingGlobal:
 *   calls.flush(zombieCount, tickMs);
 *
 * Overhead: one Proxy get (cached) + one counter bump per call — fine for debug. For a release
 * build use raw `mod` (e.g. `const M = DEBUG ? instrument(mod) : mod;`) so instrumentation is zero-cost.
 *
 * VERIFY IN-GAME: QuickJS Proxy/Reflect support. If unavailable, fall back to thin manual wrappers
 * around the hot functions (AISetTarget/AIMoveToBehavior/RayCast/GetObjectPosition).
 */


export type CallCategory = "ai" | "raycast" | "query" | "mutate" | "ui" | "other";

function categorize(name: string): CallCategory {
  if (name === "RayCast" || name.indexOf("RayCast") !== -1) return "raycast";
  if (name.indexOf("AI") === 0 || name === "SetAiInput" || name.indexOf("SpawnAI") === 0) return "ai";
  if (name.indexOf("UI") !== -1) return "ui";
  if (/^(Get|All|Is|Has|Distance|Closest|Farthest|Compare|Count|Angle|Dot|Cross)/.test(name)) return "query";
  if (/^(Set|Add|Move|Rotate|Orbit|Spawn|Unspawn|Deal|Kill|Heal|Teleport|Force|Enable|Display|Play|Stop|Resupply|Deploy|Undeploy|Send|Remove|Delete)/.test(name)) return "mutate";
  return "other";
}

class CallCounter {
  enabled = true;
  private total = 0;
  private byCat: Record<string, number> = {};
  private byFn: Record<string, number> = {};

  bump(name: string): void {
    if (!this.enabled) return;
    this.total++;
    const c = categorize(name);
    this.byCat[c] = (this.byCat[c] || 0) + 1;
    this.byFn[name] = (this.byFn[name] || 0) + 1;
  }

  /** Top-N most-called functions this window (for finding the worst offenders). */
  top(n: number): Array<[string, number]> {
    return Object.entries(this.byFn).sort((a, b) => b[1] - a[1]).slice(0, n);
  }

  totalCalls(): number {
    return this.total;
  }

  reset(): void {
    this.total = 0;
    this.byCat = {};
    this.byFn = {};
  }

  /** Emit a window summary as [TLM] (normalized per zombie) and reset the window. */
  flush(zombieCount: number, tickMs?: number): void {
    const c = this.byCat;
    const fields: Record<string, number> = {
      calls: this.total,
      callsPerZ: zombieCount > 0 ? Math.round((this.total / zombieCount) * 100) / 100 : 0,
      ai: c.ai || 0,
      raycast: c.raycast || 0,
      query: c.query || 0,
      mutate: c.mutate || 0,
      ui: c.ui || 0,
      zCount: zombieCount,
    };
    if (tickMs !== undefined) fields.tickMs = Math.round(tickMs * 100) / 100;
    Tlm.sample(fields);
    this.reset();
  }
}

/** Shared singleton counter for an experience. */
export const calls = new CallCounter();

/**
 * Wrap a mod-like namespace so every function call increments `calls`. Wrappers are memoized per
 * key, so repeated access to the same function is cheap. Pass-through for non-function members.
 */
export function instrument<T extends object>(ns: T): T {
  const cache = new Map<string, (...args: unknown[]) => unknown>();
  return new Proxy(ns, {
    get(target, prop, receiver): unknown {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== "function" || typeof prop !== "string") return v;
      let w = cache.get(prop);
      if (!w) {
        const name = prop;
        const fn = v as (...args: unknown[]) => unknown;
        w = (...args: unknown[]): unknown => {
          calls.bump(name);
          return fn.apply(target, args);
        };
        cache.set(prop, w);
      }
      return w;
    },
  }) as T;
}


// --- SOURCE: tools\soundboard\BF6_SFX\src\lib\debug\stat-hud.ts ---
/**
 * @purpose ONLINE-SAFE telemetry HUD. console.log -> PortalLog.txt only works on LOCAL host; during
 * online/server play the script runs server-side and nothing reaches the local log, so the log-tail
 * goes dark. This renders metrics on-screen instead (UI is client-rendered, so it shows online too):
 * the player reads it live and can screenshot it to read the exact values.
 *
 * Cheap by design (the bf6-portal-utils Logger lagged because it deletes+rebuilds a UIText per char every
 * call). Here a FIXED set of UIText rows is created ONCE; updates are a single SetUITextLabel per row via
 * mod.Message. mod.Message renders a raw number natively and a format string takes up to 3 "{}" items, so
 * each row shows up to 3 live numbers with one native call -- call set() at ~1 Hz, never per tick.
 */




export interface StatHudOptions {
  width?: number;
  anchor?: mod.UIAnchor;
  textColor?: mod.Vector;
}

const ROW_H = 22;

export class StatHud {
  private readonly rows: UIText[] = [];

  public constructor(player: mod.Player, rowCount: number, opts?: StatHudOptions) {
    const width = opts?.width ?? 360;
    const panel = new UIContainer({
      receiver: player,
      width,
      height: rowCount * ROW_H + 12,
      anchor: opts?.anchor ?? mod.UIAnchor.TopLeft,
      bgColor: UI.COLORS.BLACK,
      bgFill: mod.UIBgFill.Blur,
      bgAlpha: 0.8,
      visible: true,
    });
    for (let i = 0; i < rowCount; i++) {
      this.rows.push(
        new UIText({
          receiver: player,
          parent: panel,
          x: 8,
          y: 6 + i * ROW_H,
          width: width - 16,
          height: ROW_H - 2,
          anchor: mod.UIAnchor.TopLeft,
          message: mod.Message(" "),
          textSize: 18,
          textColor: opts?.textColor ?? UI.COLORS.BF_GREEN_BRIGHT,
          textAnchor: mod.UIAnchor.CenterLeft,
        })
      );
    }
  }

  /** Update one row (single native SetUITextLabel). Build `message` with a "{}"-format mod.Message. */
  public set(row: number, message: mod.Message): void {
    const r = this.rows[row];
    if (r) r.message = message;
  }
}


// --- SOURCE: node_modules\bf6-portal-utils\logger\index.ts ---




// version: 3.1.2
export class Logger {
    private static readonly _PADDING: number = 10;

    private static _getParts(text: string): string[] {
        return (text.match(/( |[^ ]{1,3})/g) ?? []) as string[];
    }

    private static _getCharacterWidth(char: string): number {
        if (['W', 'm', '@'].includes(char)) return 14;
        if (['['].includes(char)) return 13; // TODO: '[' is always prepended by a '\', so needs to be larger than ']'.
        if (['M', 'w'].includes(char)) return 12.5;
        if (['#', '?', '+'].includes(char)) return 12;
        if (['-', '='].includes(char)) return 11.5;
        if (['U', '$', '%', '&', '~'].includes(char)) return 11;
        if (['C', 'D', 'G', 'H', 'N', 'O', 'Q', 'S', '<', '>'].includes(char)) return 10.5;
        if (['0', '3', '6', '8', '9', 'A', 'B', 'V', 'X', '_'].includes(char)) return 10;
        if (['2', '4', '5', 'E', 'F', 'K', 'P', 'R', 'Y', 'Z', 'a', 'h', 's'].includes(char)) return 9.5;
        if (['7', 'b', 'c', 'd', 'e', 'g', 'n', 'o', 'p', 'q', 'u', '^', '*', '`'].includes(char)) return 9;
        if (['L', 'T', 'k', 'v', 'x', 'y', 'z'].includes(char)) return 8.5; // TODO: Maybe 'x' could be 8.
        if (['J', ']', '"', '\\', '/'].includes(char)) return 8;
        if (['1'].includes(char)) return 7.5;
        if ([' '].includes(char)) return 7;
        if (['r'].includes(char)) return 6.5; // TODO: Maybe 'r' should be 6.
        if (['f', '{', '}'].includes(char)) return 6; // TODO: Maybe 'f' should be 5.5.
        if (['t'].includes(char)) return 5.5;
        if (['(', ')', ','].includes(char)) return 5;
        if (["'", ';'].includes(char)) return 4.5;
        if (['!', 'I', '|', '.', ':'].includes(char)) return 4;
        if (['i', 'j', 'l'].includes(char)) return 3.5;

        return 10;
    }

    private static _buildMessage(part: string): mod.Message {
        if (part.length === 3) {
            return mod.Message(
                mod.stringkeys.logger.format[3],
                Logger._getChar(part[0]),
                Logger._getChar(part[1]),
                Logger._getChar(part[2])
            );
        }

        if (part.length === 2) {
            return mod.Message(mod.stringkeys.logger.format[2], Logger._getChar(part[0]), Logger._getChar(part[1]));
        }

        if (part.length === 1) {
            return mod.Message(mod.stringkeys.logger.format[1], Logger._getChar(part[0]));
        }

        return mod.Message(mod.stringkeys.logger.format.badFormat);
    }

    private static _getChar(char: string): string {
        return mod.stringkeys.logger.chars[char] ?? mod.stringkeys.logger.chars['*'];
    }

    /**
     * Creates a new logger with specific options.
     * @param player - The player to to draw the logger for.
     * @param options - The options for the logger.
     */
    constructor(player: mod.Player, options?: Logger.Options) {
        this._width = options?.width ?? 400;
        this._height = options?.height ?? 300;
        this._textColor = options?.textColor ?? UI.COLORS.BF_GREEN_BRIGHT;

        this._window = new UIContainer({
            x: options?.x ?? 10,
            y: options?.y ?? 10,
            width: this._width,
            height: this._height,
            parent: options?.parent,
            anchor: options?.anchor ?? mod.UIAnchor.TopLeft,
            bgColor: options?.bgColor ?? UI.COLORS.BF_GREY_4,
            bgAlpha: options?.bgAlpha ?? 0.5,
            bgFill: options?.bgFill ?? mod.UIBgFill.Blur,
            visible: options?.visible ?? false,
            receiver: player,
        });

        this._staticRows = options?.staticRows ?? false;
        this._truncate = this._staticRows || (options?.truncate ?? false);
        // this._scaleFactor = options?.textScale === 'small' ? 0.8 : options?.textScale === 'large' ? 1.2 : 1;
        this._scaleFactor = 1; // TODO: Implement fixes/corrections for part widths when scale factor is not 1.
        this._rowHeight = 20 * this._scaleFactor;
        this._maxRows = ~~((this._height - 2 * Logger._PADDING) / this._rowHeight); // round down to nearest integer
        this._nextRowIndex = this._maxRows - 1;
    }

    private _window: UIContainer;

    private _staticRows: boolean;

    private _truncate: boolean;

    private _rows: { [rowIndex: number]: UIContainer } = {};

    private _nextRowIndex: number;

    private _width: number;

    private _height: number;

    private _textColor: mod.Vector;

    private _scaleFactor: number;

    private _rowHeight: number;

    private _maxRows: number;

    public get maxRows(): number {
        return this._maxRows;
    }

    public get name(): string {
        return this._window.name;
    }

    public get visible(): boolean {
        return this._window.visible;
    }

    public set visible(visible: boolean) {
        this._window.visible = visible;
    }

    /**
     * Show the logger.
     * @returns The logger instance.
     */
    public show(): Logger {
        this.visible = true;
        return this;
    }

    /**
     * Hide the logger.
     * @returns The logger instance.
     */
    public hide(): Logger {
        this.visible = false;
        return this;
    }

    /**
     * Toggle the visibility of the logger.
     * @returns The logger instance.
     */
    public toggle(): Logger {
        this.visible = !this.visible;
        return this;
    }

    /**
     * Clear the logger.
     * @returns The logger instance.
     */
    public clear(): Logger {
        Object.keys(this._rows).forEach((key) => this._deleteRow(parseInt(key)));
        return this;
    }

    /**
     * Destroy the logger.
     */
    public destroy(): void {
        this.clear();
        this._window.delete();
    }

    /**
     * Log a message to the logger asynchronously (non-blocking microtask).
     * @param text - The text to log.
     * @param rowIndex - The row index to log the message to (if using static rows, default is 0).
     * @returns The logger instance.
     */
    public async logAsync(text: string, rowIndex?: number): Promise<void> {
        await Promise.resolve();

        try {
            this.log(text, rowIndex);
        } catch {
            // Swallow errors to prevent unhandled promise rejections when the promise is not awaited.
        }
    }

    /**
     * Log a message to the logger.
     * @param text - The text to log.
     * @param rowIndex - The row index to log the message to (if using static rows, default is 0).
     * @returns The logger instance.
     */
    public log(text: string, rowIndex?: number): Logger {
        if (this._staticRows) {
            this._logInRow(text, rowIndex ?? 0);
        } else {
            this._logNext(text);
        }

        return this;
    }

    private _logInRow(text: string, rowIndex: number): void {
        if (rowIndex >= this._maxRows) return; // Actually, this should be an error.

        this._fillRow(this._createRow(rowIndex), Logger._getParts(text));
    }

    private _logNext(text: string): void {
        this._logNextParts(Logger._getParts(text));
    }

    private _logNextParts(parts: string[]): void {
        let remaining: string[] | null = parts;

        while (remaining !== null) {
            const row = this._prepareNextRow();
            remaining = this._fillRow(row, remaining);
        }
    }

    private _fillRow(row: UIContainer, parts: string[]): string[] | null {
        let x = 0;
        let lastPartIndex = -1;

        for (let i = 0; i < parts.length; ++i) {
            const isLastPart = i === parts.length - 1;

            if (this._rowLimitReached(x, parts[i], isLastPart)) {
                if (this._truncate) {
                    this._createPartText(row, '...', x, 3);
                    return null;
                }

                return parts.slice(lastPartIndex + 1);
            }

            // Extra width of 3 for the last part (which likely does not have 3 characters).
            x += this._createPartText(row, parts[i], x, isLastPart ? 3 : 0);

            lastPartIndex = i;
        }

        return null;
    }

    private _rowLimitReached(x: number, part: string, isLastPart: boolean): boolean {
        const limit = this._width - Logger._PADDING * 2 - 3; // the row width minus the padding and 3 extra.

        // The early limit is the row width minus the padding, the width of the largest possible part and the width of the ellipsis.
        if (x + 57 <= limit) return false;

        // The last part is too long.
        if (isLastPart && x + this._getTextWidth(part) >= limit) return true;

        // The part plus the width of the ellipsis is too long.
        if (x + this._getTextWidth(part) + 12 >= limit) return true;

        return false;
    }

    private _prepareNextRow(): UIContainer {
        // _rows keys are always 0.._maxRows-1 (no gaps), so Object.values order matches key order and index === rowIndex.
        Object.values(this._rows).forEach((row, index) => {
            if (!row) return;

            if (row.y <= Logger._PADDING + 1) return this._deleteRow(index);

            row.y -= this._rowHeight;
        });

        const rowIndex = this._nextRowIndex;
        this._nextRowIndex = (rowIndex + 1) % this._maxRows;

        return this._createRow(rowIndex, Logger._PADDING + (this._maxRows - 1) * this._rowHeight);
    }

    private _createRow(rowIndex: number, y?: number): UIContainer {
        this._deleteRow(rowIndex);

        const row = new UIContainer({
            x: Logger._PADDING,
            y: y ?? Logger._PADDING + this._rowHeight * rowIndex,
            width: this._width - Logger._PADDING * 2,
            height: this._rowHeight,
            anchor: mod.UIAnchor.TopLeft,
            parent: this._window,
            bgFill: mod.UIBgFill.None,
        });

        this._rows[rowIndex] = row;

        return row;
    }

    private _deleteRow(rowIndex: number): void {
        this._rows[rowIndex]?.delete();
        delete this._rows[rowIndex];
    }

    private _createPartText(row: UIContainer, part: string, x: number, extraWidth: number = 0): number {
        if (part === ' ') return 7; // Space won't be a character, but instead just an instruction for the next part to be offset by 7.

        const partWidth = this._getTextWidth(part) + extraWidth;

        new UIText({
            x: x,
            y: 0,
            width: partWidth,
            height: this._rowHeight,
            anchor: mod.UIAnchor.CenterLeft,
            parent: row,
            message: Logger._buildMessage(part),
            textSize: this._rowHeight,
            textColor: this._textColor,
            textAnchor: mod.UIAnchor.CenterLeft,
        });

        return partWidth;
    }

    private _getTextWidth(part: string): number {
        return (
            this._scaleFactor *
            part.split('').reduce((accumulator, character) => accumulator + Logger._getCharacterWidth(character), 0)
        );
    }
}

export namespace Logger {
    /**
     * Options for the logger.
     */
    export interface Options {
        /**
         * Whether to use static rows (`true`) or dynamic rows (`false`).
         */
        staticRows?: boolean;
        /**
         * Whether to truncate long messages with ellipses.
         */
        truncate?: boolean;
        /**
         * The parent container for the logger.
         */
        parent?: UI.Root | UIContainer;
        /**
         * The anchor for the logger.
         */
        anchor?: mod.UIAnchor;
        /**
         * The x position of the logger.
         */
        x?: number;
        /**
         * The y position of the logger.
         */
        y?: number;
        /**
         * The width of the logger.
         */
        width?: number;
        /**
         * The height of the logger.
         */
        height?: number;
        /**
         * The background color of the logger.
         */
        bgColor?: mod.Vector;
        /**
         * The background alpha of the logger.
         */
        bgAlpha?: number;
        /**
         * The background fill of the logger.
         */
        bgFill?: mod.UIBgFill;
        /**
         * The text color of the logger.
         */
        textColor?: mod.Vector;
        /**
         * The text scale of the logger.
         */
        textScale?: 'small' | 'medium' | 'large';
        /**
         * Whether to show the logger.
         */
        visible?: boolean;
    }
}


// --- SOURCE: tools\soundboard\BF6_SFX\src\lib\debug\color-logger.ts ---
/**
 * @purpose A scrolling event log where EACH LINE can have its own color (the base bf6-portal-utils Logger
 * paints every row in one fixed color). Used by the sound-capture console to colour-code events
 * (green = play, blue = navigate, yellow = queue, red = record, cyan = music, grey = info).
 *
 * How it works: Logger creates one UIText per 1-3 chars using its private `_textColor` at the moment a row
 * is filled, and scrolling only REPOSITIONS old rows (it never repaints them). So setting the colour right
 * before each log() makes that line keep its colour while later lines use a different one. We reach the
 * private field through a typed cast (it is a plain runtime property; `private` is compile-time only).
 *
 * Built on bf6-portal-utils Logger (per-character render). Keep logging event-driven, not per-tick.
 */


/** The colour palette for log lines (BF-on-brand). r,g,b are 0-1; mirror UI.COLORS so callers need no import. */
export const LOG = {
  PLAY: mod.CreateVector(0.6784, 0.9922, 0.5255),   // BF green  -> audition / play
  NAV: mod.CreateVector(0.4392, 0.9216, 1.0),       // BF blue   -> navigation (next/prev/category/jump)
  QUEUE: mod.CreateVector(1.0, 0.9882, 0.6118),     // BF yellow -> queue add/remove
  REC: mod.CreateVector(1.0, 0.5137, 0.3804),       // BF red    -> recording lifecycle
  MUSIC: mod.CreateVector(0, 1, 1),                 // cyan      -> music / radio
  STOP: mod.CreateVector(1, 0, 0),                  // red       -> stop-all
  INFO: mod.CreateVector(0.8353, 0.9216, 0.9765),   // BF grey-1 -> system / info
  WARN: mod.CreateVector(1.0, 0.9882, 0.6118),      // yellow    -> warnings
  ERR: mod.CreateVector(1, 0, 0),                   // red       -> errors
};

export class ColorLogger extends Logger {
  /** Log one line in the given colour (defaults to INFO). Scrolling loggers (staticRows:false). */
  public logc(text: string, color: mod.Vector = LOG.INFO): this {
    (this as unknown as { _textColor: mod.Vector })._textColor = color;
    this.log(text);
    return this;
  }

  /** Write a FIXED row in the given colour (for static-row status bars). */
  public logcAt(text: string, rowIndex: number, color: mod.Vector = LOG.INFO): this {
    (this as unknown as { _textColor: mod.Vector })._textColor = color;
    this.log(text, rowIndex);
    return this;
  }
}


// --- SOURCE: tools\soundboard\BF6_SFX\src\lib\debug\index.ts ---
/** @purpose Debug kit barrel — telemetry emitter, live-tunable Debug Console, call instrumentation. */










// --- SOURCE: tools\soundboard\BF6_SFX\src\index.ts ---
/**
 * @purpose Sound CAPTURE console: audition every RuntimeSpawn SFX + Music/Radio in-game, then RECORD them to
 * disk-splittable runs. One FLAT list of all "SFX_" sounds (Next/Prev walk everything; Category jumps sections).
 * Each play prints the FULL name to console (PortalLog) so the splitter can place clips by their logged game-time.
 *
 * UI: a single BF6-themed console panel (triple-tap interact to open) — big transport buttons (Prev/Play/Next),
 * category selector, a "set starting track" jump (also = crash-resume), a QUEUE you build while browsing to record
 * specific sounds, record controls, and one big red STOP-EVERYTHING. A colour-coded scrolling log (ColorLogger)
 * shows what's happening; a 2-row status bar shows live counts + the current selection. Buttons click (a UI sound)
 * unless we're recording (so clicks never bleed into a capture).
 *
 * Capture model: SpawnObject at a high/isolated point + PlaySound at default volume with a huge attenuation range
 * (full volume map-wide); a FixedCamera is moved there and viewed through so listener foley stays off-body. An
 * SFX_Alarm marker plays first as the audio-sync anchor; every sound logs gt= (absolute game-time) so the splitter
 * places it at anchor + (gt - markerGt) with no drift. A capture is just a LIST of catalog indices (all / category /
 * current-to-end / queue), so any subset records the same way.
 */









const SK = (): typeof mod.stringkeys.snd => mod.stringkeys.snd;

const SFX_AMPLITUDE = 3.0;       // browse volume (loud, so auditions are obvious)
const SFX_RANGE = 30;
const AUTO_STOP_TICKS = 150;     // ~5s: oneshots finish, loops get cut so they don't pile up
const CLICK_STOP_TICKS = 30;     // UI click sound self-cleans quickly
const START_CATEGORY = "UI";     // open on a reliably-audible category

// ---- RECORD / capture ----
const CAPTURE_AMPLITUDE = 1.0;   // DEFAULT volume (not the loud 3.0 used for browsing)
const CAPTURE_RANGE = 10000;     // huge attenuation range -> full volume across the map regardless of listener pos
// You CANNOT SpawnObject a camera (open feature request). Instead: place a FixedCamera anywhere in the Godot map,
// put its ObjId here; the capture MOVES it to the capture point (SetObjectTransform) and views through it. -1 = off.
const CAPTURE_CAMERA_ID = 200;
const CAP_ONESHOT_SEC = 9;        // seconds for a typical one-shot
const CAP_ONESHOT_LONG_SEC = 16;  // for categories with unusually long one-shots (building collapses)
const LONG_ONESHOT_CATS = ["Destruction"];
const CAP_LOOP_SEC = 16;          // seconds for a loop (full period for the loop-point matcher)
const CAP_GAP_SEC = 0.6;          // real-time silence gap between sounds
const CAP_VO_SEC = 5;             // slot per announcer VO line (lines are ~2-4s; letters-outer order spaces repeats)
const VO_REPS = 4;                // play each (event,flag) this many times to capture the random voice-actor variants
const MATCH_EXTEND_SEC = 20;      // every sound played pushes the match time limit this far ahead
const CAPTURE_POS = (): mod.Vector => M.CreateVector(0, 150, 0); // high & isolated; (0,0,0) is UNDERGROUND here

// ---- VO ANNOUNCER ----
// Two things make VO actually play (from the user's working TDM playVO + a creator's block mod):
//  1) SPAWN A FRESH SFX_VOModule carrier for EVERY PlayVO call — a new object has no cached previous flag, so the
//     flag is always correct (the cache bug only bites a REUSED carrier).
//  2) PLAY IT TO THE TESTER PLAYER (PlayVO 4th arg = player). Many lines are TEAM-RELATIVE (winning/losing,
//     objective friendly/enemy) and are SILENT when played global; scoping to the recorder makes them audible.
// Objective*/MCom*/CheckPoint*/Sector* (non-Generic) loop the flag Alpha..India to capture all 9 letter variants;
// the rest play once. No placed objectives/capture points needed.

// ---- vehicles (in-car RADIO) ----
const VEHICLE_SPAWNER_IDS: number[] = [];
const VEHICLES = ["Vector", "GolfCart", "Cheetah", "Quadbike", "DirtBike", "Marauder", "Couch", "Flyer60", "RHIB"];

const FALLBACK_SFX: string[] = [
  "SFX_UI_Deploy_Screen_ActionSuccess_OneShot2D",
  "SFX_UI_Gamemode_Shared_LeadChange_Positive_OneShot2D",
  "SFX_Soldier_Damage_Bullet_Headshot_OneShot2D",
  "SFX_Alarm",
  "SFX_Gadgets_C4_Activate_OneShot3D",
];

const MUSIC_PACKAGES = ["Radio", "Core", "BR", "Gauntlet"];
const MUSIC_EVENTS = [
  "Core_Stinger_Positive", "Core_Stinger_RankUp", "Core_Stinger_Negative",
  "Core_Deploy_Loop", "Core_PhaseBegin", "Core_EndOfRound_Loop", "Core_Stop",
  "BR_InsertionJump", "BR_WonRound_Loop", "BR_Stop",
  "Gauntlet_Deploy", "Gauntlet_WonOperation_Loop", "Gauntlet_Stop",
];
const MUSIC_STOP_EVENTS = ["Radio_Stop", "Core_Stop", "BR_Stop", "Gauntlet_Stop"];
const RADIO_CHANNELS = ["0 HipHop", "1 Rock", "2 BF-Themes", "3 Reggaeton", "4 Biome", "5 Classical", "6 Pop"];
const RADIO_TRACK_COUNTS = [17, 18, 10, 2, 18, 32, 15];

let M: typeof mod;
let con: SoundConsole | undefined;
let tester: mod.Player | undefined;
let tick = 0;

// ONE flat list of all SFX (Next/Prev walk this); catNames/catStart give category jump points.
interface SfxEntry { name: string; cat: string; }
const allSfx: SfxEntry[] = [];
const catNames: string[] = [];
const catStart: number[] = [];
let sfxIdx = 0;

interface Active { obj: mod.Object; stopTick: number; }
const active: Active[] = [];

// capture state — a capture is just an ordered LIST of catalog indices
let capturing = false;
let capList: number[] = [];
let capPtr = 0;
let capNextTime = 0;       // real match-time (seconds) to advance to the next sound
let capLastCat = "";
let capStartGt = 0;        // game-time the alarm marker played -> the audio-sync anchor
let capCurGt = 0;          // game-time the current sound started
let capturePos: mod.Vector | undefined;
let capLabel = "";         // human label for the active run (for the log/status)

// the QUEUE: catalog indices the user picked while browsing, recorded with REC QUEUE
const recQueue: number[] = [];

// VO announcer capture (PlayVO of every VoiceOverEvents2D)
let voCapturing = false;
let voPlay = 0;       // running play counter
let voTotalPlays = 0; // total plays this run
let voList: { name: string; val: number }[] = [];          // ALL 61 announcer events
let voActive: { name: string; val: number }[] = [];        // the subset being recorded this run (current group)
// The play-plan, ordered LETTERS-OUTER / EVENTS-INNER: pass A plays one letter of every event, then pass B, etc.
// This spaces each event's repeats ~(events x gap) apart so they clear the ~30s announcer cooldown that drops
// rapid repeats of the SAME event (seen: ObjectiveCaptured A-I back-to-back only let A/D/G through). Matches the
// creator's working loop. Non-flag9 events (Generic/broadcast) appear once, in pass A only.
let voPlan: { name: string; val: number; li: number; v: number }[] = [];
let voStep = 0;
let voCarriers: mod.Object[] = []; // 9 VO carriers (one per flag), spawned ONCE at OnGameModeStarted (see spawnVoPool)
// VO GROUPS — pick a subset to record instead of all 61. "Objective"/"MCom" are the proven-working set.
const VO_GROUPS: { key: string; test: (n: string) => boolean }[] = [
  { key: "All", test: (): boolean => true },
  { key: "Objective", test: (n): boolean => /^Objective/.test(n) },
  { key: "MCom", test: (n): boolean => /^MCom/.test(n) },
  { key: "CheckPoint", test: (n): boolean => /^CheckPoint/.test(n) },
  { key: "Sector", test: (n): boolean => /^Sector/.test(n) },
  { key: "Broadcast", test: (n): boolean => !/^(Objective|MCom|CheckPoint|Sector)/.test(n) },
];
let voGroupIdx = 0;
function voGroupList(): { name: string; val: number }[] { buildVoList(); return voList.filter((e) => VO_GROUPS[voGroupIdx].test(e.name)); }
function voGroupCount(): number { let n = 0; for (const e of voGroupList()) n += isFlag9(e.name) ? VO_FLAGS.length : 1; return n; }
function stepVoGroup(d: number): void {
  voGroupIdx = ((voGroupIdx + d) % VO_GROUPS.length + VO_GROUPS.length) % VO_GROUPS.length;
  if (con) con.logc("VO group: " + VO_GROUPS[voGroupIdx].key + " (" + voGroupList().length + " events / " + voGroupCount() + " plays)", LOG.NAV);
}

let musicEvtIdx = 0;
let radioChannel = 0;
let radioTrack = 0;
let vehTypeIdx = 0;
const loadedPackages: Set<string> = new Set();

// a short UI sound played on button presses (resolved out of the live catalog)
let clickSnd: string | undefined;

const SV = (): typeof mod.SoldierStateVector => mod.SoldierStateVector;
const SB = (): typeof mod.SoldierStateBool => mod.SoldierStateBool;
const r1 = (n: number): number => Math.round(n * 10) / 10;

function cur(): SfxEntry | undefined { return allSfx[sfxIdx]; }
function curCatIndex(): number { const c = cur(); return c ? catNames.indexOf(c.cat) : 0; }
function catCount(i: number): number { return (i + 1 < catStart.length ? catStart[i + 1] : allSfx.length) - catStart[i]; }
function catEndOf(ci: number): number { return (ci + 1 < catStart.length ? catStart[ci + 1] : allSfx.length) - 1; }
/** Short display name: drop the "SFX_<cat>_" prefix. Full name still goes to console.log. */
function shortName(e: SfxEntry | undefined): string {
  if (!e) return "-";
  const pre = "SFX_" + e.cat + "_";
  return e.name.indexOf(pre) === 0 ? e.name.substring(pre.length) : e.name.replace("SFX_", "");
}
function tags(name: string): string {
  let t = name.indexOf("3D") >= 0 ? " 3D" : (name.indexOf("2D") >= 0 ? " 2D" : "");
  if (isLoop(name)) t += " LOOP";
  return t;
}

function buildCatalog(): void {
  let names: string[] = [];
  try {
    const keys = Object.keys(mod.RuntimeSpawn_Common as unknown as Record<string, unknown>);
    names = keys.filter((k): boolean => k.indexOf("SFX_") === 0);
  } catch (e) { Tlm.event("err", { where: "Object.keys", msg: ("" + e).slice(0, 60) }); }
  let usedFallback = false;
  if (names.length === 0) { names = FALLBACK_SFX.slice(); usedFallback = true; }
  const byCat: Map<string, string[]> = new Map();
  for (const n of names) {
    const parts = n.split("_");
    const cat = parts.length > 1 ? parts[1] : "Other";
    let arr = byCat.get(cat);
    if (!arr) { arr = []; byCat.set(cat, arr); }
    arr.push(n);
  }
  const sortedCats = Array.from(byCat.keys()).sort();
  allSfx.length = 0; catNames.length = 0; catStart.length = 0;
  for (const cat of sortedCats) {
    const items = byCat.get(cat) as string[];
    items.sort();
    catStart.push(allSfx.length);
    catNames.push(cat);
    for (const n of items) allSfx.push({ name: n, cat });
  }
  const sc = catNames.indexOf(START_CATEGORY);
  sfxIdx = sc >= 0 ? catStart[sc] : 0;
  resolveClickSound();
  console.log("[SND] catalog: " + allSfx.length + " SFX in " + catNames.length + " categories" + (usedFallback ? " (FALLBACK)" : ""));
  for (let i = 0; i < catNames.length; i++) console.log("[SND]   " + catNames[i] + ": " + catCount(i));
}

/** Pick a crisp UI sound for button clicks (navigate/hover, else select/confirm, else any UI 2D). */
function resolveClickSound(): void {
  const wants = (subs: string[]): string | undefined => {
    for (const e of allSfx) {
      if (e.cat !== "UI") continue;
      const lo = e.name.toLowerCase();
      for (const s of subs) if (lo.indexOf(s) >= 0) return e.name;
    }
    return undefined;
  };
  clickSnd = wants(["navigate", "rollover", "hover", "move"]) ?? wants(["select", "confirm", "button"]) ??
    (() => { for (const e of allSfx) if (e.cat === "UI" && e.name.indexOf("2D") >= 0) return e.name; return undefined; })();
}

function playerPos(): mod.Vector {
  if (tester && M.IsPlayerValid(tester)) { try { return M.GetSoldierState(tester, SV().GetPosition); } catch (e) { /* */ } }
  return M.CreateVector(0, 0, 0);
}

function stopAllSfx(): void {
  for (const a of active) {
    try { M.StopSound(a.obj as unknown as mod.SFX); } catch (e) { /* */ }
    try { M.UnspawnObject(a.obj); } catch (e) { /* */ }
  }
  active.length = 0;
}

/** A brief UI click sound — only when NOT recording, and it does NOT stop the audition that's playing. */
function uiClick(): void {
  if (capturing || voCapturing || !clickSnd || !M) return;
  const val = (mod.RuntimeSpawn_Common as unknown as Record<string, number>)[clickSnd];
  if (val === undefined) return;
  try {
    const pos = playerPos();
    const sfx = M.SpawnObject(val as unknown as mod.RuntimeSpawn_Common, pos, M.CreateVector(0, 0, 0), M.CreateVector(1, 1, 1)) as unknown as mod.Object;
    M.PlaySound(sfx as unknown as mod.SFX, 1.0, pos, 50);
    active.push({ obj: sfx, stopTick: tick + CLICK_STOP_TICKS });
  } catch (e) { /* */ }
}

function playSfx(e: SfxEntry): void {
  if (!M || !tester) return;
  const val = (mod.RuntimeSpawn_Common as unknown as Record<string, number>)[e.name];
  if (val === undefined) { if (con) con.logc("INVALID " + shortName(e), LOG.ERR); return; }
  stopAllSfx();
  try {
    // In the booth we play at the camera/listener point with a huge range so auditions are always audible no matter
    // where the soldier actually auto-spawned; otherwise (camera off) play at the soldier with the normal range.
    const pos = capturePos ?? playerPos();
    const range = capturePos ? CAPTURE_RANGE : SFX_RANGE;
    const sfx = M.SpawnObject(val as unknown as mod.RuntimeSpawn_Common, pos, M.CreateVector(0, 0, 0), M.CreateVector(1, 1, 1)) as unknown as mod.Object;
    M.PlaySound(sfx as unknown as mod.SFX, SFX_AMPLITUDE, pos, range);
    active.push({ obj: sfx, stopTick: tick + AUTO_STOP_TICKS });
    console.log("[SND] " + (sfxIdx + 1) + "/" + allSfx.length + "  " + e.name); // FULL name to copy
    if (con) con.logc("> " + shortName(e) + tags(e.name), LOG.PLAY);
    extendMatch();
  } catch (err) { if (con) con.logc("ERROR " + shortName(e), LOG.ERR); }
}

function playCurrent(): void { const e = cur(); if (e) playSfx(e); }
function stepSfx(d: number): void {
  if (allSfx.length === 0) return;
  sfxIdx = ((sfxIdx + d) % allSfx.length + allSfx.length) % allSfx.length;
  playCurrent();
}
/** Shift the current index WITHOUT playing — for "set starting track" / crash-resume. */
function jump(d: number): void {
  if (allSfx.length === 0) return;
  sfxIdx = ((sfxIdx + d) % allSfx.length + allSfx.length) % allSfx.length;
  if (con) con.logc("-> track " + (sfxIdx + 1) + "/" + allSfx.length + "  " + shortName(cur()), LOG.NAV);
}
function stepCat(d: number): void {
  if (catNames.length === 0) return;
  const ci = ((curCatIndex() + d) % catNames.length + catNames.length) % catNames.length;
  sfxIdx = catStart[ci];
  if (con) con.logc("== " + catNames[ci] + " (" + catCount(ci) + ") ==", LOG.NAV);
}

// ---- queue ----
function queueToggle(): void {
  const p = recQueue.indexOf(sfxIdx);
  if (p >= 0) { recQueue.splice(p, 1); if (con) con.logc("queue remove " + shortName(cur()) + "  (" + recQueue.length + ")", LOG.QUEUE); }
  else { recQueue.push(sfxIdx); if (con) con.logc("queue add " + shortName(cur()) + "  (" + recQueue.length + ")", LOG.QUEUE); }
}
function queueCat(): void {
  const ci = curCatIndex();
  const s = catStart[ci];
  const e = (ci + 1 < catStart.length ? catStart[ci + 1] : allSfx.length) - 1;
  let n = 0;
  for (let i = s; i <= e; i++) if (recQueue.indexOf(i) < 0) { recQueue.push(i); n++; }
  if (con) con.logc("queue add " + catNames[ci] + "  (+" + n + ", total " + recQueue.length + ")", LOG.QUEUE);
}
function queueClear(): void { recQueue.length = 0; if (con) con.logc("queue cleared", LOG.QUEUE); }

// ---- music ----
function curSquad(): mod.Squad | undefined {
  if (!tester) return undefined;
  try { return M.GetSquad(tester); } catch (e) { return undefined; }
}
function setMP(name: string, val: number): void {
  const p = (mod.MusicParams as unknown as Record<string, number>)[name];
  if (p === undefined) return;
  const sq = curSquad();
  try { if (sq) M.SetMusicParam(p as unknown as mod.MusicParams, val, sq); else M.SetMusicParam(p as unknown as mod.MusicParams, val); } catch (e) { /* */ }
}
function playME(name: string): void {
  const ev = (mod.MusicEvents as unknown as Record<string, number>)[name];
  if (ev === undefined) return;
  const sq = curSquad();
  try { if (sq) M.PlayMusic(ev as unknown as mod.MusicEvents, sq); else M.PlayMusic(ev as unknown as mod.MusicEvents); } catch (e) { /* */ }
}
function playMusicEvent(): void {
  const evt = MUSIC_EVENTS[musicEvtIdx % MUSIC_EVENTS.length];
  playME(evt);
  console.log("[SND] PlayMusic " + evt);
  if (con) con.logc("music " + evt, LOG.MUSIC);
  musicEvtIdx = (musicEvtIdx + 1) % MUSIC_EVENTS.length;
}
function radioPlayTrack(): void {
  setMP("Radio_Amplitude", 2.0);
  setMP("Radio_Channel", radioChannel);
  if (radioChannel === 4) setMP("Radio_Biome", 0);
  setMP("Radio_ContinueQueueOnTrackEnd", 1);
  setMP("Radio_LoopQueuedTracks", 1);
  playME("Radio_ClearQueue");
  setMP("Radio_QueueTrackNumber", radioTrack);
  playME("Radio_Play");
  console.log("[SND] Radio ch" + radioChannel + " track " + radioTrack);
  if (con) con.logc("RADIO " + RADIO_CHANNELS[radioChannel] + " trk " + radioTrack, LOG.MUSIC);
  radioTrack = (radioTrack + 1) % RADIO_TRACK_COUNTS[radioChannel];
}
function radioChannelNext(): void {
  radioChannel = (radioChannel + 1) % RADIO_CHANNELS.length;
  radioTrack = 0;
  setMP("Radio_Channel", radioChannel);
  if (con) con.logc("radio ch: " + RADIO_CHANNELS[radioChannel], LOG.MUSIC);
}

function stopEverything(): void {
  stopAllSfx();
  for (const evt of MUSIC_STOP_EVENTS) playME(evt);
  capturing = false; voCapturing = false;
  // VO carrier pool persists (reused across runs, must outlive any single REC) — not unspawned here
  if (con) con.show(); else assertBooth(); // stay in the booth + reopen the panel; never strand the operator
  console.log("[SND] STOP EVERYTHING");
  if (con) con.logc("** STOP EVERYTHING **", LOG.STOP);
}

// ---- RECORD / capture ----
function isLoop(name: string): boolean { return name.indexOf("Loop") >= 0; }
function gt3(t: number): string { return ("" + (Math.round(t * 1000) / 1000)); }
/** Push the match time limit out so a long recording can't end mid-sweep. */
function extendMatch(): void {
  if (!M) return;
  try {
    const limit = M.GetRoundTime();
    const now = M.GetMatchTimeElapsed();
    const base = limit > now ? limit : now;
    M.SetGameModeTimeLimit(base + MATCH_EXTEND_SEC);
  } catch (e) { /* */ }
}

function capturePlay(e: SfxEntry): void {
  const val = (mod.RuntimeSpawn_Common as unknown as Record<string, number>)[e.name];
  if (val === undefined) { console.log("[CAP] INVALID " + e.name); return; }
  stopAllSfx();
  try {
    const pos = capturePos ?? playerPos();
    const sfx = M.SpawnObject(val as unknown as mod.RuntimeSpawn_Common, pos, M.CreateVector(0, 0, 0), M.CreateVector(1, 1, 1)) as unknown as mod.Object;
    M.PlaySound(sfx as unknown as mod.SFX, CAPTURE_AMPLITUDE, pos, CAPTURE_RANGE);
    active.push({ obj: sfx, stopTick: tick + 999999 });
    extendMatch();
  } catch (err) { console.log("[CAP] ERROR " + e.name + ": " + ("" + err).slice(0, 40)); }
}

/** Build the index list for the chosen mode and start a run. */
function startCapture(mode: "all" | "cat" | "from" | "queue"): void {
  if (allSfx.length === 0) return;
  let list: number[] = [];
  let label = "";
  if (mode === "all") { for (let i = 0; i < allSfx.length; i++) list.push(i); label = "ALL " + allSfx.length; }
  else if (mode === "cat") { const ci = curCatIndex(); for (let i = catStart[ci]; i <= catEndOf(ci); i++) list.push(i); label = catNames[ci] + " " + list.length; }
  else if (mode === "from") { const end = catEndOf(curCatIndex()); for (let i = sfxIdx; i <= end; i++) list.push(i); label = catNames[curCatIndex()] + " from #" + (sfxIdx - catStart[curCatIndex()] + 1); }
  else { list = recQueue.slice(); label = "QUEUE " + list.length; }
  if (list.length === 0) { if (con) con.logc("nothing to record: " + label, LOG.WARN); return; }
  capList = list; capPtr = 0; capLabel = label;
  beginCaptureRun();
}

/** Put the operator in the capture BOOTH: point the map-placed FixedCamera at the isolated capture point and view
 *  through it, so the audio listener is off-body (idle foley stays far away). Sets capturePos as the listener anchor.
 *  Called on spawn, whenever the panel is shown, and after a recording ends — the operator is never stranded. */
function assertBooth(): void {
  if (!M || !tester) return;
  capturePos = CAPTURE_POS();
  if (CAPTURE_CAMERA_ID < 0) return; // no FixedCamera placed -> sounds just play at the soldier (still audible)
  try {
    const cam = M.GetFixedCamera(CAPTURE_CAMERA_ID);
    M.SetObjectTransform(cam as unknown as mod.Object, M.CreateTransform(capturePos, M.CreateVector(0, 0, 0)));
    M.SetCameraTypeForPlayer(tester, mod.Cameras.Fixed, CAPTURE_CAMERA_ID);
  } catch (e) { console.log("[CAP] camera err " + ("" + e).slice(0, 50)); }
}

/** Play the SFX_Alarm audio-sync marker at the booth point (start of every capture run). */
function playMarker(): void {
  const pos = capturePos ?? CAPTURE_POS();
  const markVal = (mod.RuntimeSpawn_Common as unknown as Record<string, number>).SFX_Alarm;
  if (markVal === undefined) return;
  try {
    const m = M.SpawnObject(markVal as unknown as mod.RuntimeSpawn_Common, pos, M.CreateVector(0, 0, 0), M.CreateVector(1, 1, 1)) as unknown as mod.Object;
    M.PlaySound(m as unknown as mod.SFX, CAPTURE_AMPLITUDE, pos, CAPTURE_RANGE);
    active.push({ obj: m, stopTick: tick + 25 });
  } catch (e) { /* */ }
}

function beginCaptureRun(): void {
  capturing = true;
  capLastCat = "";
  if (con) con.close(); // close the panel so UI-input mode doesn't block the capture view
  assertBooth();        // ensure the FixedCamera is at the capture point and we're viewing through it
  capStartGt = M.GetMatchTimeElapsed(); // ANCHOR: the alarm marker's game-time == its audio onset in the recording
  capNextTime = capStartGt + 1.0;       // ~1s real lead-in before the first sound
  capCurGt = capStartGt;
  playMarker();
  console.log("[CAP] MARKER SFX_Alarm gt=" + gt3(capStartGt) + "  (audio-sync anchor)");
  extendMatch();
  console.log("[CAP] ===== RECORDING START (marker=SFX_Alarm) " + capList.length + " sounds [" + capLabel + "] =====");
  if (con) con.logc("REC " + capLabel + " - start OBS now", LOG.REC);
}

function stopCapture(): void {
  capturing = false;
  stopAllSfx();
  if (con) con.show(); else assertBooth(); // back to the booth + reopen the panel (never strand the operator)
  console.log("[CAP] ===== RECORDING STOPPED =====");
  if (con) con.logc("recording stopped", LOG.REC);
}

function captureTick(): void {
  const now = M.GetMatchTimeElapsed();
  if (!capturing || now < capNextTime) return;
  if (capPtr >= capList.length) { stopCapture(); return; }
  const gi = capList[capPtr];
  const e = allSfx[gi];
  if (e.cat !== capLastCat) { capLastCat = e.cat; console.log("[CAP] === CATEGORY " + e.cat + " ==="); }
  // gt= is the absolute game-time the sound starts -> the splitter places it at anchor + (gt - capStartGt). No drift.
  console.log("[CAP] " + (gi + 1) + "/" + allSfx.length + " gt=" + gt3(now) + " dt=" + gt3(now - capStartGt) + " [" + e.cat + "] " + e.name + (isLoop(e.name) ? " (LOOP)" : ""));
  capCurGt = now;
  if (con) con.logc("rec " + (capPtr + 1) + "/" + capList.length + " " + shortName(e) + tags(e.name), LOG.REC);
  capturePlay(e);
  const slotSec = isLoop(e.name) ? CAP_LOOP_SEC : (LONG_ONESHOT_CATS.indexOf(e.cat) >= 0 ? CAP_ONESHOT_LONG_SEC : CAP_ONESHOT_SEC);
  capNextTime = now + slotSec + CAP_GAP_SEC;
  capPtr++;
}

// ---- VO announcer capture ----
// The bundler INLINES VoiceOverEvents2D member access (const-enum style): only STATIC references resolve, so every
// event is listed by name here (same pattern the official mods + vip_escort_script use).
function buildVoList(): void {
  if (voList.length > 0) return;
  const add = (name: string, val: mod.VoiceOverEvents2D): void => { voList.push({ name, val: val as unknown as number }); };
  // Ordered by how reliably they BROADCAST (2026 Discord: the announcer VO is buggy/random, no context fixes it).
  // TIER 1 -- broadcast state lines that play with no live objective (record these; most are audible):
  add("GlobalAircraftAvailable", mod.VoiceOverEvents2D.GlobalAircraftAvailable); // confirmed audible
  add("GlobalEOMVictory", mod.VoiceOverEvents2D.GlobalEOMVictory);               // confirmed audible
  add("GlobalEOMDefeat", mod.VoiceOverEvents2D.GlobalEOMDefeat);                 // confirmed audible
  add("GlobalAirstrikeWarning", mod.VoiceOverEvents2D.GlobalAirstrikeWarning);
  add("GlobalOutOfBounds", mod.VoiceOverEvents2D.GlobalOutOfBounds);
  add("FirstSpawn", mod.VoiceOverEvents2D.FirstSpawn);
  add("FirstSpawnDefender", mod.VoiceOverEvents2D.FirstSpawnDefender);
  add("PlayerCountFriendlyLow", mod.VoiceOverEvents2D.PlayerCountFriendlyLow);
  add("PlayerCountEnemyLow", mod.VoiceOverEvents2D.PlayerCountEnemyLow);
  add("VehicleArmoredSpawn", mod.VoiceOverEvents2D.VehicleArmoredSpawn);
  add("VehicleTankSpawn", mod.VoiceOverEvents2D.VehicleTankSpawn);
  add("RoundStartGeneric", mod.VoiceOverEvents2D.RoundStartGeneric);
  add("RoundEndFriendlyKills", mod.VoiceOverEvents2D.RoundEndFriendlyKills);
  add("RoundEndEnemyKills", mod.VoiceOverEvents2D.RoundEndEnemyKills);
  add("RoundEndFriendlyCapture", mod.VoiceOverEvents2D.RoundEndFriendlyCapture);
  add("RoundEndEnemyCapture", mod.VoiceOverEvents2D.RoundEndEnemyCapture);
  add("RoundLastRound", mod.VoiceOverEvents2D.RoundLastRound);
  add("RoundSuddenDeath", mod.VoiceOverEvents2D.RoundSuddenDeath);
  add("RoundSwitchSides", mod.VoiceOverEvents2D.RoundSwitchSides);
  add("Time120Left", mod.VoiceOverEvents2D.Time120Left);
  add("Time60Left", mod.VoiceOverEvents2D.Time60Left);
  add("Time30Left", mod.VoiceOverEvents2D.Time30Left);
  add("TimeLow", mod.VoiceOverEvents2D.TimeLow);
  add("TimeOvertime", mod.VoiceOverEvents2D.TimeOvertime);
  add("ProgressEarlyWinning", mod.VoiceOverEvents2D.ProgressEarlyWinning);
  add("ProgressEarlyLosing", mod.VoiceOverEvents2D.ProgressEarlyLosing);
  add("ProgressMidWinning", mod.VoiceOverEvents2D.ProgressMidWinning);
  add("ProgressMidLosing", mod.VoiceOverEvents2D.ProgressMidLosing);
  add("ProgressLateWinning", mod.VoiceOverEvents2D.ProgressLateWinning);
  add("ProgressLateLosing", mod.VoiceOverEvents2D.ProgressLateLosing);
  // TIER 2 -- objective family: buggy (engine caches/randomises the flag), needs the placed CapturePoints/MCOMs:
  add("ObjectiveCaptured", mod.VoiceOverEvents2D.ObjectiveCaptured);
  add("ObjectiveCapturedGeneric", mod.VoiceOverEvents2D.ObjectiveCapturedGeneric);
  add("ObjectiveCapturedEnemy", mod.VoiceOverEvents2D.ObjectiveCapturedEnemy);
  add("ObjectiveCapturedEnemyGeneric", mod.VoiceOverEvents2D.ObjectiveCapturedEnemyGeneric);
  add("ObjectiveCapturing", mod.VoiceOverEvents2D.ObjectiveCapturing);
  add("ObjectiveContested", mod.VoiceOverEvents2D.ObjectiveContested);
  add("ObjectiveLocated", mod.VoiceOverEvents2D.ObjectiveLocated);
  add("ObjectiveLockdownFriendly", mod.VoiceOverEvents2D.ObjectiveLockdownFriendly);
  add("ObjectiveLockdownEnemy", mod.VoiceOverEvents2D.ObjectiveLockdownEnemy);
  add("ObjectiveLost", mod.VoiceOverEvents2D.ObjectiveLost);
  add("ObjectiveNeutralised", mod.VoiceOverEvents2D.ObjectiveNeutralised);
  add("ObjectiveTerritoryTaken", mod.VoiceOverEvents2D.ObjectiveTerritoryTaken);
  add("ObjectiveTerritoryTakenGeneric", mod.VoiceOverEvents2D.ObjectiveTerritoryTakenGeneric);
  add("ObjectiveTerritoryLost", mod.VoiceOverEvents2D.ObjectiveTerritoryLost);
  add("ObjectiveTerritoryLostGeneric", mod.VoiceOverEvents2D.ObjectiveTerritoryLostGeneric);
  add("MComArmFriendly", mod.VoiceOverEvents2D.MComArmFriendly);
  add("MComArmEnemy", mod.VoiceOverEvents2D.MComArmEnemy);
  add("MComDefuseFriendly", mod.VoiceOverEvents2D.MComDefuseFriendly);
  add("MComDefuseEnemy", mod.VoiceOverEvents2D.MComDefuseEnemy);
  add("MComDestroyedFriendly", mod.VoiceOverEvents2D.MComDestroyedFriendly);
  add("MComDestroyedEnemy", mod.VoiceOverEvents2D.MComDestroyedEnemy);
  add("MComDestroyedOneLeftFriendly", mod.VoiceOverEvents2D.MComDestroyedOneLeftFriendly);
  add("MComDestroyedOneLeftEnemy", mod.VoiceOverEvents2D.MComDestroyedOneLeftEnemy);
  // TIER 3 -- need a LIVE Breakthrough advance/retreat flow; effectively always silent in a sandbox (grouped last):
  add("CheckPointFriendly", mod.VoiceOverEvents2D.CheckPointFriendly);
  add("CheckPointFriendlyAnother", mod.VoiceOverEvents2D.CheckPointFriendlyAnother);
  add("CheckPointEnemy", mod.VoiceOverEvents2D.CheckPointEnemy);
  add("CheckPointEnemyAnother", mod.VoiceOverEvents2D.CheckPointEnemyAnother);
  add("CheckPointMovingToLastFriendly", mod.VoiceOverEvents2D.CheckPointMovingToLastFriendly);
  add("CheckPointMovingToLastEnemy", mod.VoiceOverEvents2D.CheckPointMovingToLastEnemy);
  add("SectorTakenAttacker", mod.VoiceOverEvents2D.SectorTakenAttacker);
  add("SectorTakenDefender", mod.VoiceOverEvents2D.SectorTakenDefender);
  console.log("[VO] " + voList.length + " announcer events (first val=" + (voList.length ? voList[0].val : "?") + ")");
}
// 9 flags Alpha..India + their letters; one dedicated VO carrier per flag is spawned per run.
const VO_FLAGS: mod.VoiceOverFlags[] = [
  mod.VoiceOverFlags.Alpha, mod.VoiceOverFlags.Bravo, mod.VoiceOverFlags.Charlie, mod.VoiceOverFlags.Delta,
  mod.VoiceOverFlags.Echo, mod.VoiceOverFlags.Foxtrot, mod.VoiceOverFlags.Golf, mod.VoiceOverFlags.Hotel, mod.VoiceOverFlags.India,
];
const VO_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
/** Objective/MCom (and experimentally CheckPoint/SectorTaken) speak an objective LETTER -> capture all 9 (A-I).
 *  "Generic" variants have no letter. CheckPoint/Sector are unproven (creator only did Objective+MCom) but harmless
 *  to try — they sit last in the run, so silent ones are easy to skip. */
function isFlag9(name: string): boolean { return /^(Objective|MCom|CheckPoint|SectorTaken)/.test(name) && name.indexOf("Generic") < 0; }
/** Team-relative lines (winning/losing/friendly/enemy/attacker/defender) need a TEAM target so the engine knows
 *  whose perspective to render; everything else is targeted at the player (audible at the camera). */
function isTeamRel(name: string): boolean { return /(Winning|Losing|Friendly|Enemy|Attacker|Defender|Attacking|Defending|Kills|Capture)/i.test(name); }
/** Spawn the 9 VO carriers ONCE at OnGameModeStarted (one per flag A..I), like the.postminimalist + the creator.
 *  CRITICAL: a VO carrier must be spawned on an EARLIER frame than the PlayVO call — spawning + playing in the
 *  same tick produces NO audio (the object isn't initialized yet). This was the silent-objective bug. Idempotent. */
function spawnVoPool(): void {
  if (!M || voCarriers.length >= VO_FLAGS.length) return;
  const voVal = (mod.RuntimeSpawn_Common as unknown as Record<string, number>).SFX_VOModule_OneShot2D;
  for (let i = voCarriers.length; i < VO_FLAGS.length; i++) {
    try { voCarriers.push(M.SpawnObject(voVal as unknown as mod.RuntimeSpawn_Common, M.CreateVector(0, 0, 0), M.CreateVector(0, 0, 0), M.CreateVector(0, 0, 0)) as unknown as mod.Object); } catch (e) { /* */ }
  }
}
/** Play one VO using the PRE-SPAWNED carrier for flag index `li` (never spawn-and-play same tick).
 *  target = undefined => GLOBAL (3-arg, proven for objective/MCom/broadcast); team-relative lines pass a TEAM. */
function playVoOne(val: number, flag: mod.VoiceOverFlags, li: number, target: unknown): void {
  const carrier = voCarriers[li] ?? voCarriers[0];
  try {
    if (carrier && target) M.PlayVO(carrier as unknown as mod.VO, val as unknown as mod.VoiceOverEvents2D, flag, target as mod.Player);
    else if (carrier) M.PlayVO(carrier as unknown as mod.VO, val as unknown as mod.VoiceOverEvents2D, flag);
  } catch (err) { /* logged by caller */ }
}

function startVoCapture(): void {
  voActive = voGroupList(); // only the selected group (default "All")
  if (voActive.length === 0) { if (con) con.logc("no VO events in group " + VO_GROUPS[voGroupIdx].key, LOG.WARN); return; }
  // Build the play-plan. Outer = variant rep (1..VO_REPS) so each (event,flag) is captured VO_REPS times to grab
  // the random voice-actor variants; within each rep, LETTERS-OUTER / EVENTS-INNER (pass A = one letter of every
  // event, then pass B, ...) so the same event never repeats within the ~30s announcer cooldown.
  voPlan = [];
  for (let rep = 1; rep <= VO_REPS; rep++) {
    for (let L = 0; L < VO_FLAGS.length; L++) {
      for (const e of voActive) {
        const f9 = isFlag9(e.name);
        if (!f9 && L > 0) continue; // non-flag9 events have no letter -> one per rep, in pass A only
        voPlan.push({ name: e.name, val: e.val, li: f9 ? L : 0, v: rep });
      }
    }
  }
  capturing = false; voCapturing = true; voStep = 0; voPlay = 0; capLastCat = "";
  voTotalPlays = voPlan.length;
  if (con) con.close();
  // VO ONLY: stay a LIVE SOLDIER (FirstPerson), NOT the FixedCamera. The FixedCamera silences PlayVO — the VO
  // listener is the player's soldier (proven: votest as a soldier plays all 17; harness on the booth cam is
  // silent). There's no visual to frame for VO anyway. Marker + listener move to the soldier's position.
  try { if (tester) M.SetCameraTypeForPlayer(tester, mod.Cameras.FirstPerson); } catch (e) { /* */ }
  capturePos = playerPos();
  spawnVoPool();        // ensure carriers exist (normally spawned at OnGameModeStarted, well before this REC)
  capStartGt = M.GetMatchTimeElapsed();
  capNextTime = capStartGt + 1.0;
  capCurGt = capStartGt;
  playMarker();
  console.log("[CAP] MARKER SFX_Alarm gt=" + gt3(capStartGt) + "  (audio-sync anchor)");
  extendMatch();
  console.log("[CAP] ===== RECORDING START (VO group " + VO_GROUPS[voGroupIdx].key + ") " + voTotalPlays + " plays / " + voActive.length + " events =====");
  if (con) con.logc("REC " + VO_GROUPS[voGroupIdx].key + " " + voTotalPlays + " VO lines - start OBS now", LOG.REC);
}
function voCaptureTick(): void {
  const now = M.GetMatchTimeElapsed();
  if (!voCapturing || now < capNextTime) return;
  if (voStep >= voPlan.length) { stopVoCapture(); return; }
  const p = voPlan[voStep];
  const f9 = isFlag9(p.name);
  if (capLastCat !== "Announcer") { capLastCat = "Announcer"; console.log("[CAP] === CATEGORY Announcer ==="); }
  // name encodes event + flag-letter + variant: VO_<event>_<A..I>_v<n>  (non-flag9: VO_<event>_v<n>)
  const nm = (f9 ? ("VO_" + p.name + "_" + VO_LETTERS[p.li]) : ("VO_" + p.name)) + "_v" + p.v;
  voPlay++;
  console.log("[CAP] " + voPlay + "/" + voTotalPlays + " gt=" + gt3(now) + " dt=" + gt3(now - capStartGt) + " [Announcer] " + nm);
  capCurGt = now;
  if (con) con.logc("rec VO " + voPlay + "/" + voTotalPlays + " " + (f9 ? p.name + " " + VO_LETTERS[p.li] : p.name) + " v" + p.v, LOG.REC);
  // target: GLOBAL (no target) by default — the two PROVEN working examples (the.postminimalist + the creator's
  // script) play objective/MCom VO global with 3 args; a player target silences them. Only team-relative lines
  // (winning/losing/friendly/enemy/...) get a TEAM target (TDM-proven) so the engine renders the right perspective.
  let voTarget: unknown = undefined;
  if (tester && isTeamRel(p.name)) { try { voTarget = M.GetTeam(tester); } catch (err) { voTarget = undefined; } }
  playVoOne(p.val, VO_FLAGS[p.li], p.li, voTarget);
  extendMatch();
  capNextTime = now + CAP_VO_SEC + CAP_GAP_SEC;
  voStep++;
}
function stopVoCapture(): void {
  voCapturing = false;
  stopAllSfx();
  // VO carrier pool persists (reused across runs, must outlive any single REC) — not unspawned here
  assertBooth();                 // restore the FixedCamera booth (VO put us on FirstPerson)
  if (con) con.show(); // reopen the panel
  console.log("[CAP] ===== RECORDING STOPPED =====");
  if (con) con.logc("VO recording stopped", LOG.REC);
}

// ---- vehicles ----
function spawnVehicles(): void {
  if (VEHICLE_SPAWNER_IDS.length === 0) { if (con) con.logc("set VEHICLE_SPAWNER_IDS first", LOG.WARN); return; }
  const typeName = VEHICLES[vehTypeIdx % VEHICLES.length];
  const tv = (mod.VehicleList as unknown as Record<string, number>)[typeName];
  let n = 0;
  for (const id of VEHICLE_SPAWNER_IDS) {
    try {
      const sp = M.GetVehicleSpawner(id);
      if (!sp) continue;
      if (tv !== undefined) M.SetVehicleSpawnerVehicleType(sp, tv as unknown as mod.VehicleList);
      M.ForceVehicleSpawnerSpawn(sp);
      n++;
    } catch (e) { /* */ }
  }
  if (con) con.logc("spawned " + typeName + " x" + n, LOG.INFO);
}

// ====================================================================================================
// SoundConsole — the BF6-themed control panel (built on bf6-portal-utils UI components + ColorLogger).
//
// HOW TO MODIFY (for other users):
//  - Buttons are declared as data in the constructor: this.row([{ label, color, on, help }, ...]). Each row is a
//    set of equal-width buttons. To add a button, add another { } to a row (≤4 per row reads best) or add a new
//    this.row([...]). `label` is a strings.json key under snd.btn (the visible text); `color` is the text colour;
//    `on` is what it does; `help` is the one-line explanation shown in-game in the HELP bar when you hover it.
//  - Every button shows its `help` text in the bottom HELP bar on hover (onFocusIn) — so the panel is
//    self-documenting in-game. Keep help to one sentence: what it does + how it behaves.
//  - Colours use UI.COLORS (BF palette). Log line colours use LOG.* (see color-logger.ts).
//  - Layout is anchored to the panel CENTRE so it scales with the safe area. The status bar + colour-coded log
//    sit OUTSIDE the panel (top-right) so they stay visible while recording, even with the panel hidden.
// ====================================================================================================
const PANEL_W = 740;
const PANEL_H = 560;
const HEAD_H = 46;
const PAD = 16;
const ROW_H_2 = 38;
const GAP = 8;
const HELP_Y = 394; // y (inside the content region) where the in-game HELP bar sits, below all the buttons

interface BtnDef { label: string; color: mod.Vector; on: () => void; help: string; }

// palette
const C_PANEL = UI.COLORS.BF_GREY_4;
const C_HEAD = UI.COLORS.BF_RED_BRIGHT;
const C_BTN = UI.COLORS.BF_GREY_3;
const C_HOVER = UI.COLORS.BF_GREY_2;
const C_PRESS = UI.COLORS.BF_BLUE_DARK;
const T_NAV = UI.COLORS.BF_BLUE_BRIGHT;
const T_PLAY = UI.COLORS.BF_GREEN_BRIGHT;
const T_QUEUE = UI.COLORS.BF_YELLOW_BRIGHT;
const T_REC = UI.COLORS.BF_RED_BRIGHT;
const T_MUSIC = UI.COLORS.CYAN;
const T_INFO = UI.COLORS.BF_GREY_1;

class SoundConsole {
  private readonly player: mod.Player;
  private readonly root: UIContainer;
  private readonly content: UIContainer;
  private readonly log: ColorLogger;
  private readonly status: ColorLogger;
  private readonly help: UIText; // bottom HELP bar: shows each button's explanation (strings.json) on hover
  private y = 0; // running layout cursor inside content
  private lastS0 = "";
  private lastS1 = "";
  private lastHelp = "";

  public constructor(player: mod.Player) {
    this.player = player;

    // always-visible colour-coded event log (top-right)
    this.log = new ColorLogger(player, {
      staticRows: false, truncate: true, visible: true,
      anchor: mod.UIAnchor.TopRight, x: 16, y: 92, width: 470, height: 540,
      bgColor: C_PANEL, bgAlpha: 0.78, bgFill: mod.UIBgFill.Blur,
    });
    // always-visible 2-row status bar (top-right, above the log): row0 selection, row1 counts/REC
    this.status = new ColorLogger(player, {
      staticRows: true, truncate: true, visible: true,
      anchor: mod.UIAnchor.TopRight, x: 16, y: 16, width: 470, height: 64,
      bgColor: C_PANEL, bgAlpha: 0.85, bgFill: mod.UIBgFill.Blur,
    });

    // the panel (hidden until triple-tap)
    this.root = new UIContainer({
      receiver: player, width: PANEL_W, height: PANEL_H, anchor: mod.UIAnchor.Center,
      bgColor: C_PANEL, bgFill: mod.UIBgFill.Blur, bgAlpha: 0.9,
      visible: false, uiInputModeWhenVisible: true,
    });
    // header gradient + title
    new UIContainer({
      receiver: player, parent: this.root, x: 0, y: 0, width: PANEL_W, height: HEAD_H,
      anchor: mod.UIAnchor.TopCenter, bgColor: C_HEAD, bgFill: mod.UIBgFill.GradientLeft, bgAlpha: 1,
    });
    new UIText({
      receiver: player, parent: this.root, x: PAD, y: 0, width: PANEL_W - PAD * 2, height: HEAD_H,
      anchor: mod.UIAnchor.TopLeft, textAnchor: mod.UIAnchor.CenterLeft, textSize: 24,
      textColor: UI.COLORS.BLACK, message: mod.Message(SK().title),
    });
    // content region below the header
    this.content = new UIContainer({
      receiver: player, parent: this.root, x: 0, y: HEAD_H + 6, width: PANEL_W, height: PANEL_H - HEAD_H - 6,
      anchor: mod.UIAnchor.TopCenter, bgFill: mod.UIBgFill.None, bgAlpha: 0,
    });
    // bottom HELP bar: a frosted panel + a text line that every button updates (via strings.json) on hover
    new UIContainer({
      receiver: player, parent: this.content, x: PAD, y: HELP_Y, width: PANEL_W - PAD * 2, height: 96,
      anchor: mod.UIAnchor.TopLeft, bgColor: UI.COLORS.BF_BLUE_DARK, bgAlpha: 0.6, bgFill: mod.UIBgFill.Blur,
    });
    this.help = new UIText({
      receiver: player, parent: this.content, x: PAD + 12, y: HELP_Y + 10, width: PANEL_W - PAD * 2 - 24, height: 76,
      anchor: mod.UIAnchor.TopLeft, textAnchor: mod.UIAnchor.TopLeft, textSize: 16,
      textColor: UI.COLORS.BF_GREY_1, message: mod.Message(SK().help.idle),
    });

    const b = SK().btn;
    const h = SK().help;
    // ---- TRANSPORT: audition sounds ----
    this.row([
      { label: b.prev, color: T_NAV, on: (): void => stepSfx(-1), help: h.prev },
      { label: b.play, color: T_PLAY, on: playCurrent, help: h.play },
      { label: b.next, color: T_NAV, on: (): void => stepSfx(1), help: h.next },
      { label: b.qToggle, color: T_QUEUE, on: queueToggle, help: h.qToggle },
    ]);
    // ---- CATEGORY + QUEUE management ----
    this.row([
      { label: b.catPrev, color: T_NAV, on: (): void => stepCat(-1), help: h.catPrev },
      { label: b.catNext, color: T_NAV, on: (): void => stepCat(1), help: h.catNext },
      { label: b.qCat, color: T_QUEUE, on: queueCat, help: h.qCat },
      { label: b.qClear, color: T_QUEUE, on: queueClear, help: h.qClear },
    ]);
    // ---- SET STARTING TRACK (silent jump; also crash-resume) ----
    this.row([
      { label: b.jM10, color: T_NAV, on: (): void => jump(-10), help: h.jM10 },
      { label: b.jM1, color: T_NAV, on: (): void => jump(-1), help: h.jM1 },
      { label: b.jP1, color: T_NAV, on: (): void => jump(1), help: h.jP1 },
      { label: b.jP10, color: T_NAV, on: (): void => jump(10), help: h.jP10 },
    ]);
    this.gap(6);
    // ---- RECORD controls ----
    this.row([
      { label: b.recCat, color: T_REC, on: (): void => startCapture("cat"), help: h.recCat },
      { label: b.recFrom, color: T_REC, on: (): void => startCapture("from"), help: h.recFrom },
      { label: b.recQueue, color: T_REC, on: (): void => startCapture("queue"), help: h.recQueue },
    ]);
    this.row([
      { label: b.recAll, color: T_REC, on: (): void => startCapture("all"), help: h.recAll },
      { label: b.recStop, color: T_REC, on: (): void => { stopCapture(); stopVoCapture(); }, help: h.recStop },
    ]);
    // ---- VO group: pick a subset (Objective/MCom = proven) then REC VO GROUP ----
    this.row([
      { label: b.voGrpPrev, color: T_NAV, on: (): void => stepVoGroup(-1), help: h.voGrp },
      { label: b.voGrpNext, color: T_NAV, on: (): void => stepVoGroup(1), help: h.voGrp },
      { label: b.recVO, color: T_REC, on: startVoCapture, help: h.recVO },
    ]);
    this.gap(6);
    // ---- MUSIC / RADIO ----
    this.row([
      { label: b.radio, color: T_MUSIC, on: radioPlayTrack, help: h.radio },
      { label: b.radioCh, color: T_MUSIC, on: radioChannelNext, help: h.radioCh },
      { label: b.musEvt, color: T_MUSIC, on: playMusicEvent, help: h.musEvt },
    ]);
    this.gap(10);
    this.bigBtn(52, SK().btn.stopAll, 22, UI.COLORS.BF_RED_BRIGHT, UI.COLORS.BF_RED_DARK, UI.COLORS.RED, (): void => stopEverything(), h.stopAll);
    this.bigBtn(28, SK().btn.close, 16, T_INFO, C_BTN, C_PRESS, (): void => this.close(), h.close);

    new MultiClickDetector(player, (): void => this.toggle());
    this.showHelp(h.idle);
    this.status.logcAt("triple-tap INTERACT to hide / show this panel", 0, T_INFO);
  }

  /** One row of equal-width buttons. */
  private row(items: BtnDef[]): void {
    const n = items.length;
    const cw = (PANEL_W - PAD * 2 - GAP * (n - 1)) / n;
    items.forEach((it, i) => this.mkBtn(PAD + i * (cw + GAP), this.y, cw, ROW_H_2, it));
    this.y += ROW_H_2 + GAP;
  }
  private gap(amount: number): void { this.y += amount; }

  /** A full-width button (STOP EVERYTHING / HIDE) with its own colours + hover help. */
  private bigBtn(height: number, label: string, textSize: number, textColor: mod.Vector, base: mod.Vector, hot: mod.Vector, on: () => void, help: string): void {
    const w = PANEL_W - PAD * 2;
    const btn = new UITextButton({
      receiver: this.player, parent: this.content, x: PAD, y: this.y, width: w, height,
      anchor: mod.UIAnchor.TopLeft, bgColor: base, baseColor: base,
      message: mod.Message(label), textSize, textColor,
      onClickUp: (): void => { uiClick(); on(); },
    });
    btn.focusedColor = hot; btn.pressedColor = hot;
    btn.onFocusIn = (): void => this.showHelp(help);
    this.y += height + GAP;
  }

  private mkBtn(x: number, y: number, w: number, h: number, def: BtnDef): void {
    const btn = new UITextButton({
      receiver: this.player, parent: this.content, x, y, width: w, height: h,
      anchor: mod.UIAnchor.TopLeft, bgColor: C_BTN, baseColor: C_BTN,
      message: mod.Message(def.label), textSize: 17, textColor: def.color,
      onClickUp: (): void => { uiClick(); def.on(); },
    });
    btn.focusedColor = C_HOVER; btn.pressedColor = C_PRESS;
    btn.onFocusIn = (): void => this.showHelp(def.help); // self-documenting: explain the button in-game on hover
  }

  /** Show a button's explanation (strings.json key) in the bottom HELP bar (only when it changed). */
  private showHelp(key: string): void {
    if (key === this.lastHelp) return;
    this.lastHelp = key;
    this.help.message = mod.Message(key);
  }

  public logc(text: string, color?: mod.Vector): void { this.log.logc(text, color); }

  /** Refresh the persistent status bar (called ~2 Hz). Only rewrites a row when its text changed. */
  public refresh(rate: number): void {
    const e = cur();
    const s0 = e ? "[" + e.cat + "] " + shortName(e) + tags(e.name) : "-";
    let s1: string;
    let c1: mod.Vector;
    if (capturing) { s1 = "REC " + capPtr + "/" + capList.length + "  gt " + Math.round(capCurGt - capStartGt) + "s  [" + capLabel + "]"; c1 = T_REC; }
    else if (voCapturing) { s1 = "REC VO " + voPlay + "/" + voTotalPlays + "  gt " + Math.round(capCurGt - capStartGt) + "s"; c1 = T_REC; }
    else { s1 = "sfx " + (sfxIdx + 1) + "/" + allSfx.length + "   cat " + (curCatIndex() + 1) + "/" + catNames.length + "   VO grp: " + VO_GROUPS[voGroupIdx].key + "   q " + recQueue.length; c1 = T_INFO; }
    if (s0 !== this.lastS0) { this.lastS0 = s0; this.status.logcAt(s0, 0, capturing || voCapturing ? T_REC : T_PLAY); }
    if (s1 !== this.lastS1) { this.lastS1 = s1; this.status.logcAt(s1, 1, c1); }
  }

  public toggle(): void { if (this.root.visible) this.close(); else this.show(); }
  // show() re-asserts the booth camera every time, so reopening the panel can never leave the operator stranded.
  public show(): void { assertBooth(); this.root.visible = true; mod.EnableUIInputMode(true, this.player); uiClick(); }
  public close(): void { this.root.visible = false; mod.EnableUIInputMode(false, this.player); }
}

// ---- setup ----
/** Build the catalog + console once (first deploy). */
function ensureConsole(player: mod.Player): void {
  if (con) return;
  buildCatalog();
  con = new SoundConsole(player);
  con.logc("catalog: " + allSfx.length + " SFX in " + catNames.length + " categories", T_INFO);
  con.logc("auto-deployed to the capture booth - hover any button for help", T_INFO);
  Tlm.event("harnessReady", { stage: "sound-console", total: allSfx.length });
}
/** Run on EVERY (auto)deploy: build once, put the operator in the booth with the panel open. */
function enterBooth(player: mod.Player): void {
  tester = player;
  // NOTE: do NOT SetTeam here — GetTeam(1) returns an INVALID team in this gamemode and SetTeam throws
  // ("team input being invalid", seen in PortalLog). The player is already auto-assigned to a valid team on
  // deploy; team-relative VO lines use M.GetTeam(tester) (that valid team) as the target in voCaptureTick.
  ensureConsole(player);
  assertBooth();
  if (con) con.show();
}

// ---- wiring ----
Events.OnGameModeStarted.subscribe((): void => {
  M = instrument(mod);
  console.log("[TLM] harness-sound OnGameModeStarted");
  // AUTO-DEPLOY: skip the deploy screen so the operator spawns straight into the booth (official pattern, as in
  // the BumperCars / AcePursuit example mods). OnPlayerDeployed then puts them on the camera with the panel open.
  try { M.SetSpawnMode(mod.SpawnModes.AutoSpawn); } catch (e) { /* */ }
  spawnVoPool(); // spawn the 9 VO carriers NOW (game start) so they're initialized long before any PlayVO
  for (const pkg of MUSIC_PACKAGES) {
    const v = (mod.MusicPackages as unknown as Record<string, number>)[pkg];
    if (v !== undefined) {
      try {
        M.LoadMusic(v as unknown as mod.MusicPackages);
        loadedPackages.add(pkg);
        const ap = (mod.MusicParams as unknown as Record<string, number>)[pkg + "_Amplitude"];
        if (ap !== undefined) M.SetMusicParam(ap as unknown as mod.MusicParams, 2.0);
      } catch (e) { /* */ }
    }
  }
  console.log("[SND] preloaded music: " + Array.from(loadedPackages).join(", "));
});
Events.OnPlayerDeployed.subscribe((player: mod.Player): void => {
  if (!M) return;
  try {
    if (M.GetSoldierState(player, SB().IsAISoldier)) return;
    enterBooth(player); // every (auto)deploy re-asserts the booth camera + reopens the panel
  } catch (e) { Tlm.event("err", { where: "OnPlayerDeployed", msg: ("" + e).slice(0, 80) }); }
});
Events.OngoingGlobal.subscribe((): void => {
  if (!M || !con) return;
  try {
    tick++;
    if (active.length > 0) {
      for (let i = active.length - 1; i >= 0; i--) {
        if (tick >= active[i].stopTick) {
          try { M.StopSound(active[i].obj as unknown as mod.SFX); } catch (e) { /* */ }
          try { M.UnspawnObject(active[i].obj); } catch (e) { /* */ }
          active.splice(i, 1);
        }
      }
    }
    if (capturing) captureTick();
    else if (voCapturing) voCaptureTick();
    if (tick % 15 === 0) con.refresh(r1(PerformanceStats.getSpotTickRate()));
  } catch (e) { Tlm.event("err", { where: "OngoingGlobal", tick: tick, msg: ("" + e).slice(0, 80) }); }
});

