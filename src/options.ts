import { logwarn, toTypeString, logerror } from "./helper";
import { Listener } from "./listener";
import * as t from "./types";

export interface DirtyOptions extends Partial<Omit<Options, "exclude">> {
	exclude?: Listener | Listener[];
}

const emitAsOptions = ["this", "global", "empty"] as const;
type EmitAs = typeof emitAsOptions[number];

export class Options {
	groupTimeout: number = 0;
	groupDelay: number = 0;// the amount of time to wait before executing the next group (which can allow things to propogate if need be)
	defaultIndex: number = 0;
	#onProgress: t.OnProgressFunc = () => {};
	get onProgress() { return this.#onProgress; }
	set onProgress(x: t.OnProgressFunc) {
		this.#onProgress = (...args: Parameters<t.OnProgressFunc>) => {
			try { x.apply(this, args); }
			catch (err) { logwarn.call(this, err); }
		};
	}

	onerror: VoidFunction = logerror;
	returnStatus: boolean = true;// true => emitEvent() will return an object (@see _getStatusObj()), else a promise
	allowDuplicates: boolean = false;// true=>allow the same listener to be added multiple times
	#emitAs: EmitAs = "this";
	get emitAs() { return this.#emitAs; }
	set emitAs(x: EmitAs) {
		if (emitAsOptions.includes(x)) { this.#emitAs = x; }
		else { throw new TypeError(`Expected one of ${emitAsOptions.join("|")}, got: ${toTypeString(x)}`); }
	}

	#listeners: t.GroupedListeners = {};
	get listeners() { return this.#listeners; }
	set listeners(x: object) {
		if (t.isGroupedListeners(x))
			this.#listeners = x;
		else
			throw new Error(`Option 'listeners' should be the object returned from BetterEvents.getListenersForEmit(), got: ${toTypeString(x)}`);
	}

	exclude: Listener[] = [];

	/**
	* Parse and combine options
	*
	* @param ...options Any number of dirty or already cleaned options. They will Object.assign'd in order
	*
	* @throws TypeError If any dirty options have the wrong type
	*/
	constructor(...options: (Partial<Options> | undefined)[]) {
		const dirty = Object.assign({}, ...options); // TODO: lift out the already cleaned ones...

		// Loop through all defined keys...
		for (const key in this) {
			if (key in dirty) { // ...and if they're passed in...
				let expected = typeof this[key];
				if (typeof dirty[key] == expected && dirty[key] !== null) // ...make sure they're the correct type...
					this[key] = dirty[key]; // ...and let the setters perform any aditional checks if need be
				else
					throw new TypeError(`Option '${key}' should be a ${expected}, got: ${toTypeString(dirty[key])}`);
			}
		}
	}
}
