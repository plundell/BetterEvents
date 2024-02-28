import { Listener } from "./listener";

export type VoidFunction = (...args: any) => void;
export type ListenerFunction = (...args: any) => any | Promise<any>;

export type EventPattern = string | RegExp;

// Ugly hack because I can't figure out how to do it properly and you probably won't see longer string than this so whatever
export type PlusOrMinus = "+" | "++" | "+++" | "++++" | "+++++" | "++++++" | "-" | "--" | "---" | "----" | "-----" | "------";

export function isPlusOrMinusString(x: any): x is PlusOrMinus {
	return (typeof x == "string" && (/^\++$/.test(x) || /^-+$/.test(x)));
}
export type PlusMinusIndex = PlusOrMinus | number;
export function isIndexArg(x: any): x is PlusMinusIndex {
	return typeof x == "number" || isPlusOrMinusString(x);
}

export type onceArg = boolean | "once";
export function isOnceArg(x: any): x is onceArg {
	return x === "once" || typeof x == "boolean";
}

export type optionalArgs = onceArg | PlusMinusIndex;
/**
 * The first arg passed to the Listener constructor
 * @param {string|RegExp} 0      The event to listen for
 * @param {function} 1        Callback to call when $event is emitted. If/when it returns 'off' it will be removed from event
 * @param {boolean|string} 2      Boolean or string 'once'. The listener will be removed after the first call.
 * @param {number|string} 3      The order in which to run the listener. (sometimes called 'group' in this file):
 *                                   - Lower numbers run sooner.
 *                                   - All listeners with same index run concurrently.
 *                                   - Use one or multiple '+'/'-' to run in relation to options.defaultIndex
 */
export type ListenerArgsArray = [EventPattern, ListenerFunction, ...optionalArgs[]];

export type ListenerArgsObj = {
	evt: EventPattern;
	callback: ListenerFunction;
	once: boolean;
	index: number;
};

export const groupedListenerFlag = "_createdByGetListenersForEmit";
export type GroupedListeners = Record<string, Listener[]>;
export function isGroupedListeners(x: any): x is GroupedListeners {
	return (x && typeof x == "object" && groupedListenerFlag in x);
}

export type OnProgressFunc = (evt: string, status: Status | BasicStatus, g?: number, j?: number) => void;

export type ResultItem = [boolean, any, number, number];
export type statusEntry = [string, string, number, number];

export interface CommonStatus {
	length: number;
	listeners: Listener[];
	waiting: number;
	executing: number;
	finished: number;
	progress: number;
	done: boolean;
	names: string[];
}

export interface GroupStatus extends CommonStatus {
	[key: string]: string | number | Function | any;
	started: boolean;
	remaining: number;
	statusEntries: () => statusEntry[];
}

export interface BasicStatus {
	[key: BasicStatus["groups"][number]]: GroupStatus | any; // TODO: this doesn't limit keys to the value of groups... see if that can be done
	results: ResultItem[];
	groups: string[];
	intercepted: boolean;
	promise?: Promise<ResultItem[]>;
	length: number;
}

export interface Status extends CommonStatus, BasicStatus {
	statusEntries: () => statusEntry[];
	groupsStarted: number;
	groupsDone: number;
	groupsExecuting: number;
	groupsWaiting: number;
}

export type CompoundListener = Listener & {
	remaining: any[];
	fired: any[];
};
