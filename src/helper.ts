import { BetterEvents } from "./better_events";
import { Listener } from "./listener";
import { BasicStatus, GroupStatus, Status } from "./types";

/*
* Turn any value into a string suitable to put into an error msg
*
* @param any value
*
* @return string    Finite length string (max ~70 characters)
* @private
*/
export function toTypeString(value) {
	if (value == null || value == undefined) {
		return `<${"" + value}>`;
	}
	else {
		let str = value.toString();
		if (str.length > 50)
			str = str.slice(0, 25) + "..." + str.slice(-25);

		let type = typeof value;
		if (type == "object")
			type = value.__proto__.constructor.name;

		return `(${type})${str}`;
	}
}

/*
* Create pretty output to go in new TypeError (but leave the creation of said error in
* the calling function so the stack is accurate)
*
* @param number i
* @param string expected
* @param any value
*
* @return string
* @private
*/
export function errString(i, expected, value) {
	switch (expected) {
		case "listener": expected = "a listener function"; break;
		case "interceptor": expected = "an interceptor function"; break;
		case "s_evt": expected = "a string event"; break;
		case "r_evt": expected = "a <RegExp> event"; break;
		case "evt":
		case "event":
			expected = "a string or <RegExp> event";
			break;
	}
	return `Arg #${i} should be ${expected}, got: ${toTypeString(value)}`;
}

/*
* @param object groupedListeners The object returned by _getGroupedListeners()
* @param boolean returnStatus    If true this function will add a bunch of getters to @return and that object will be returned by emitEvent()
*
* NOTE: This object is the one passed to onProgress(), so you may want to set returnStatus==true if you plan on showing pretty progress stuff
*
* @return object                 The object populated and then returned by emitEvent
* @private
*/
export function _getStatusObj<T extends boolean>(groupedListeners, returnStatus: T): T extends true ? Status : BasicStatus {
	const status: Partial<Status> = {};
	Object.defineProperties(status, {
		results: { value: [] } // results in whichever order they finish, child arrays are [true/false, result, i, j]
		, groups: { value: Object.keys(groupedListeners).sort() } // <<---------------------------------- this is what decides group order
		, intercepted: { value: false, writable: true }
		, promise: { value: undefined, writable: true, enumerable: false },
		// ^changed to an actual promise by emitEvent() to return o.results. defined here as non-enum so getters vv don't count it
	});

	Object.defineProperty(status.results, "get", {
		value:
			function getResult(g, j) {
				return status?.results?.find(result => result[2] == g && result[3] == j);
			},
	});

	let l = 0;
	if (status.groups) {
		for (const g of status.groups) { // this is the ordered keys
			const group = status[g] = {} as GroupStatus; // these are the only enumerable props on the status object...
			for (const j in groupedListeners[g]) {
				group[j] = "waiting"; // ...and these the only enumerable on ^
				l++;
			}

			// If opted add getters that get states in the group
			if (returnStatus) {
				Object.defineProperties(group, {
					length: { value: Object.keys(group).length }
					, listeners: { value: groupedListeners[g] }
					, waiting: { get: () => Object.values(group).reduce((sum, state) => sum + (state == "waiting" ? 1 : 0), 0) }
					, executing: { get: () => Object.values(group).reduce((sum, state) => sum + (state == "executing" ? 1 : 0), 0) }
					, finished: { get: () => Object.values(group).reduce((sum, state) => sum + (state == "finished" ? 1 : 0), 0) }
					, started: { get: () => group.length > group.waiting }
					, remaining: { get: () => group.length - group.finished }
					, progress: { get: () => Math.round(group.finished / group.length * 100) || 0 }
					, done: { get: () => group.progress == 100 }
					, names: { value: Object.values(groupedListeners[g]).map(listener => listener.callback.name || "anonymous") }
					, statusEntries: { value: () => group.names.map((name, j) => [name, group[j], g, j]) },
					// ^DevNote: We call it 'statusEntries' because it kind of works like Object.entries(group) except we're using the name instead of the key
				});
			}
		}
	}
	Object.defineProperty(status, "length", { value: l });

	// If opted add getters that sum every group to give aggregates
	if (returnStatus) {
		Object.defineProperties(status, {
			listeners: { value: groupedListeners }
			, waiting: { get: () => Object.values(status).reduce((sum, group) => sum + group.waiting, 0) }
			, executing: { get: () => Object.values(status).reduce((sum, group) => sum + group.executing, 0) }
			, finished: { get: () => status.results.length } // regarless of group, how many listeners have finished
			, progress: { get: () => Math.round(status.finished / status.length * 100) || 0 } // of total listeners, how many have finished, 0-100
			, done: { get: () => status.progress == 100 }
			, names: { get: () => status.groups.map(g => status[g].names).flat() }
			, statusEntries: { value: () => status.groups.map(g => status[g].statusEntries()).flat() }

			, groupsStarted: { get: () => Object.values(status).reduce((sum, group) => sum + (group.started ? 1 : 0), 0) }
			, groupsDone: { get: () => Object.values(status).reduce((sum, group) => sum + (group.done ? 1 : 0), 0) }
			, groupsExecuting: { get: () => status.length - status.groupsDone }
			, groupsWaiting: { get: () => status.length - status.groupsStarted },

		});
	}
	return status as Status;
}

/*
* Turn args into an arguments object
* @param array|<arguments>|any
* @return <arguments>
*/
export function makeArgs(args) {
	if (args == undefined) {
		args = [];
	}
	else if (typeof args == "object" && args) {
		if (Object.hasOwnProperty.call(args, "callee")
			&& Object.hasOwnProperty.call(args, "length")
			&& Object.getOwnPropertySymbols(args).map(String) == "Symbol(Symbol.iterator)"
		) {
			return args;
		}
		else if (!Array.isArray(args)) {
			args = [args];
		}
	}
	else {
		args = [args];
	}
	return _makeArgs.apply(this, args);
}
export function _makeArgs() { return arguments; }

/*
* Verbose logger that respects possible devmode
*/
export function logdebug(...args) {
	if (process && process?.env?.NODE_ENV == "development")
		((this ? (this.log || this._log) : undefined) || console).debug(...args);
}
export function logwarn(...args) {
	((this ? (this.log || this._log) : undefined) || console).warn(...args);
}
/*
* Error logger
*/
export function logerror(...args) {
	if (this) {
		const log = this.log || this._log;
		if (log && typeof log.error == "function") {
			log.error(...args);
			return;
		}
		if (this._betterEvents) {
			console.warn("No log set on event emitter created @", this._betterEvents.createdAt);
		}
		else {
			console.warn("BetterEvents error handler called with this set to:", this);
		}
	}
	console.error(...args);
}

function replaceStack(targetErr, stackSrc) {
	targetErr.stack = targetErr.toString() + stackSrc.stack.replace(stackSrc.toString, "");
	return targetErr;
}
