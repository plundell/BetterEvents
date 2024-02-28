import { BetterEvents } from "./better_events";
import { makeArgs } from "./helper";
import { Options } from "./options";
import * as t from "./types";

const no_callback_set: t.VoidFunction = () => {};
const no_evt_set = new RegExp("manthatitalianfamilyatthenexttablesurearequite");
/**
* @class Listener These are the objects waiting for events to be emitted
*
*/
export class Listener {
	#index: number;
	set index(x: t.PlusMinusIndex) {
		if (typeof x == "number")
			this.#index = x;
		else if (t.isPlusOrMinusString(x))
			this.#index += (x.length * (x.startsWith("+") ? 1 : -1));
	}

	get index(): number { return this.#index; }

	#once: boolean = false;
	set once(x: t.onceArg) { if (t.isOnceArg(x)) this.#once = x == true; } // x can be false|true|'once', so this check works
	get once(): boolean { return this.#once; }

	#callback: t.ListenerFunction = no_callback_set;
	set callback(x: t.ListenerFunction) {
		if (typeof x != "function")
			throw new TypeError("Expected a function, got: " + JSON.stringify(x));
		else if (this.#callback != no_callback_set)
			throw new TypeError("Cannot reassign Listener.callback");
		else
			this.#callback = x;
	}

	get callback(): t.ListenerFunction { return this.#callback; }

	#evt: t.EventPattern = no_evt_set;
	set evt(x: t.EventPattern) {
		if (typeof x != "string" && !(x instanceof RegExp))
			throw new TypeError("Listner.evt should be a string or RegExp, got: " + JSON.stringify(x));
		else if (this.#evt != no_evt_set)
			throw new TypeError("Cannot reassign Listener.evt");
		else
			this.#evt = x;
	}

	get evt() { return this.#evt; }

	#createdAt: string;
	get createdAt(): string { return this.#createdAt; }

	#emitter: BetterEvents;
	get emitter(): BetterEvents { return this.#emitter; }

	#runs: number = 0;
	get runs(): number { return this.#runs; }

	/**
	 * Shortcut to the options on the parent emitter
	 */
	get #options():	Options { return this.#emitter._betterEvents.options; }

	/**
	 * @param args         		Array of args
	 * @param emitter
	*/
	constructor(args: t.ListenerArgsObj, emitter: BetterEvents);
	constructor(args: t.ListenerArgsArray, emitter: BetterEvents);
	constructor(args: t.ListenerArgsObj | t.ListenerArgsArray, emitter: BetterEvents) {
		if (!args || typeof args != "object")
			throw new TypeError("Expected arg #1 to be an array of ordered args or an object of named args, got: " + JSON.stringify(args));
		if (!(emitter instanceof BetterEvents))
			throw new TypeError("Expected arg #2 to be an instance of BetterEvents, got: " + JSON.stringify(emitter));

		// Set defaults for values which couldn't be specified statically for class
		this.#index = this.#options.defaultIndex;
		this.#emitter = emitter;
		this.#createdAt = (new Error())?.stack?.split("\n").slice(2)[0].trim().replace(/^at\s+/, "") || "unknown";

		// Assign the passed in args, letting the setters validate and throw if need be
		if (Array.isArray(args)) {
			// The first two are required and should be in order. We don't have to check if they've been set like
			// the case with the object below since the setters will throw
			this.#evt = args[0];
			this.#callback = args[1];

			// ...whereas the optional
			for (let i = 2; i < 4; i++) {
				if (t.isOnceArg(args[i]))
					this.once = args[i] == true;
				else if (t.isIndexArg(args[i])) {

				}
			}
		}
		else {
			// This implies an object, so just assign...
			Object.assign(this, args);

			// ...however we can't know that our two required have been set, so check
			if (this.#callback == no_callback_set)
				throw new Error("Missing required arg 'callback'. Cannot create Listener.");

			if (this.#evt == no_evt_set)
				throw new Error("Missing required arg 'evt'. Cannot create Listener.");
		}
		// A single object with named props can be passed in...
	}

	// Finally, add a method that can always be used to remove this listener from this object...
	remove() {
		try {
			this.emitter.removeListener(this.callback, this.evt);
			return true;
		}
		catch (e) {
			return false; // the listener had previously been removed
		}
	}

	// ...and one that can be used to add a timeout that fires if the event hasn't fired within that timespan
	timeout(callback, timeout, cancelOnTimeout) {
		const n0 = this.runs; // run times when timeout is registered...
		return setTimeout(() => {
			// ...compared to run times on timeout
			if (this.runs == n0) {
				if (cancelOnTimeout)
					this.remove();
				callback.call(this.emitter);
			}
		}, timeout);
	}

	/**
	* Execute (.apply) the callback
	*
	* @param callAs
	* @param args
	* @param evt       The event that caused this to run. only relevant if this.evt is regexp
	*
	* @return Promise(result,error)
	*/
	execute(callAs: object, args: any[], evt?: string) {
		return new Promise((resolve, reject) => {
			// Make sure that the callback runs async (allowing any sync calls after it to run first)
			setTimeout(async () => {
				try {
					// Increment counter
					this.#runs++;

					// Remove from emitter BEFORE since the callback may emit the event again
					if (this.once)
						this.remove();

					// If our .evt is a RegExp, and a specific event is used to apply (ie. the regular behaviour of emitEvent()),
					// prepend that event to the args
					if (typeof this.evt != "string" && typeof evt == "string")
						args = [evt].concat(args);

					// Now run the callback which may return a value or a promise...
					const result = await this.callback.apply(callAs, args);

					// The return value may be reason to remove it...
					if (result == "off")
						this.remove();
					// ^DevNote: the 'off' is meant for here, but we pass it on anyway for potential logging purposes

					// Finally we return what may be a promise or may be a value
					return resolve(result);
				}
				catch (err) {
					reject(err);
				}
			}, 0);
		});
	}

	/*
	* @param string emittedEvt
	* @return Promise(void,n/a);
	*/
	async executeAfter(callAs: object, emittedEvt: string) {
		var args;
		const listenerEventFailed = new Error(`Listener executed after ${emittedEvt} failed.`);
		try {
			// Get possible pending promise for a currently running event
			let running = this.emitter._betterEvents.running[emittedEvt];
			if (running) {
				await running.slice(-1);
			}

			// get the args the emitted last
			args = this.emitter._betterEvents.emitted[emittedEvt];

			this.execute(callAs, args, emittedEvt);
		}
		catch (e) {
			this.emitter._betterEvents.onerror(listenerEventFailed, { listener: this, args: makeArgs(args) }, e);
		}
	}

	toString() {
		const created = this.createdAt.split("\n")[0].trim().replace(/^at\s+/, "");
		return `<Listener event:${this.evt} registered:${created}>`;
	}
}
