"use strict";
/**
 * @module BetterEvents
 * @author plundell
 * @license MIT
 * @description Advanced zero-dependency event emitter written in TypeScript for NodeJS and browsers.
 */
import { toTypeString, errString, _getStatusObj, logdebug, logwarn, logerror } from "./helper";
import { Listener } from "./listener";
import { Options } from "./options";
import { GroupedListeners, groupedListenerFlag, ListenerFunction, CompoundListener, VoidFunction } from "./types";

const globalObj = typeof global != "undefined"
	? global
	: typeof window != "undefined"
		? window
		: {};

type _BetterEvents = {
	options: Options;
	onerror: VoidFunction;
	emitted: {};
	after: {};
	bufferEvt: {};
	buffer: [];
	intercept: {};
	running: {};
	createdAt: string;
	events: {};
	regexp: Listener[];
	onUnhandled: null;
};

export class BetterEvents {
	public _betterEvents: _BetterEvents;

	constructor(_options?: Partial<Options>) {
		// Parse the options
		const options = new Options(_options);

		// Set the default values
		this._betterEvents = {
			options
			, onerror: () => {}// just placeholder to apease typescript, will be changed below
			, emitted: {}
			, after: {}
			, bufferEvt: {}
			, buffer: []
			, intercept: {}
			, running: {}
			, createdAt: (new Error())?.stack?.split("\n").slice(2)[0].trim().replace(/^at\s+/, "") || "unknown"
			, events: {}
			, regexp: []
			, onUnhandled: null
		};

		// Update the onerror prop to be a getter which links to the one from the options
		const propOnerror = Object.getOwnPropertyDescriptor(this._betterEvents, "onerror") || {}; // {} is just to shut typescript up
		propOnerror.enumerable = false; // 2024-02-28: unsure why non-enum, but previous comment said so
		delete propOnerror.value;
		propOnerror.get = () => this._betterEvents.options.onerror;
		Object.defineProperty(this._betterEvents, "onerror", propOnerror);
	}

	/*
	* Removes all listeners for all events (ie. reset this emitter)
	* @return this
	*/
	removeAllListeners(evt = undefined) {
		// Make compatible with node events
		if (evt) {
			this.removeEvent(evt);
		}
		else {
			this._betterEvents.events = {};
			this._betterEvents.regexp = [];
			// ^Just like events^, one regexp can have multiple listeners, but regexps are objects so can't
			// be keys, and we don't want to use a Map since we want to compare their toString()s, so we
			// will store them on array as [[regex1,func1],[regex2,func2],...]
			// this._betterEvents.onAll=[];            //2020-10-12: just using regexp now
			this._betterEvents.onUnhandled = null;
		}

		return this;
	}

	/**
	* Add a listener to an event.
	*
	* @params ...any args        @see Listener() parsing of args
	*
	* NOTE 1: Duplicate callbacks for the same event CAN be added, but .emitEvent() will only
	*         call the first occurence of each callback unless options.allowDuplicates is truthy
	*
	* NOTE 2: Callbacks that return promises that never resolve can prevent other listeners
	*         for the same event from running
	*
	* @throw TypeError
	* @return <Listener>
	*/
	addListener(...args: ConstructorParameters<typeof Listener>[0]) { // TODO: this doesn't accept an object with key'd stuff
		// Create the <Listener>
		const listener = new Listener(args, this);

		// Add it to the appropriate place
		if (typeof listener.evt == "string") {
			(this._betterEvents.events[listener.evt] || (this._betterEvents.events[listener.evt] = [])).push(listener);
		}
		else {
			this._betterEvents.regexp.push(listener);
		}

		return listener;
	}

	/**
	* Alias for addListener, but without possibility of additional args
	*
	* @param string evt
	* @param function listener
	*
	* @return <Listener>
	*/
	on(evt, listener) {
		return this.addListener(evt, listener);
	}

	/**
	* Add a listener which is only run once
	*
	* @param string evt
	* @param function listener
	*
	* @return <Listener>
	*/
	once(evt, listener) {
		return this.addListener(evt, listener, true); // true=>once
	}

	/*
	* Set a listener for all otherwise unhandled events
	*
	* NOTE: Calling this method multiple times will only replace the previous listener
	* NOTE2:The onAll listeners will NOT make an event count as 'handled' and this
	*       listener will still fire
	*
	* @param function|false listener    False removes any set listener
	*
	* @return void
	*/
	onUnhandled(listener) {
		if (listener === false || listener === null) {
			this._betterEvents.onUnhandled = null;
			return false;
		}
		else if (typeof listener != "function")
			throw new TypeError(errString(1, "listener", listener));

		// NOTE: this object has no 'e' prop, which means that emitEvent() will call it
		// with the evt string as first arg and it will be ignored by removeEvent()

		this._betterEvents.onUnhandled = { l: listener };

		return;
	}

	/*
	* Add a listener for all events        //2020-10-12: just using regexp now
	*
	* @return <Listener>
	*/
	onAll(...args) {
		return this.addListener(/.+/, ...args);
	}

	/*
	* Check if an event has already been emitted
	*
	* @param string|<RegExp> evt   NOTE: A regex will be used to match regular events, it will not match
	*                               the string version of itself, eg. '/test/'
	*
	* @return string|undefined    The name of the first matching emitted event, or undefined
	*/
	alreadyEmitted(evt) {
		if (evt instanceof RegExp) {
			return Object.keys(this._betterEvents.emitted)
				.find(_evt => _evt.match(evt));
		}
		else if (typeof evt == "string") {
			return Object.hasOwnProperty.call(this._betterEvents.emitted, evt) ? evt : undefined;
		}
		else {
			throw new TypeError(errString(1, "evt", evt));
		}
	}

	/*
	* If an event hasn't been emitted, run a callback, optionally first waiting
	*
	* @param string evt     Event to look for, see this.alreadyEmitted()
	* @param function cb    Function to run if event hasn't been emitted
	* @param number wait    If omitted the check will happen syncronously
	*
	* @return function      Function to cancel timeout.
	*/
	ifNotEmitted(evt, cb, wait) {
		const _ifNotEmitted = () => {
			if (!this.alreadyEmitted(evt)) {
				try {
					const p = cb.call(this);
					if (p instanceof Promise)
						p.catch(this._betterEvents.onerror);
				}
				catch (e) {
					this._betterEvents.onerror(e);
				}
			}
		};
		let id;
		if (wait == undefined) {
			_ifNotEmitted();
		}
		else {
			id = setTimeout(_ifNotEmitted, wait);
		}
		return () => { clearTimeout(id); };
	}

	/*
	* Remove stored emitted events. This will affect emitOnce(), alreadyEmitted() and after()
	*
	* @param string|<RegExp> evt   NOTE: A regex will be used to match regular events, it will not match
	*                               the string version of itself, eg. '/test/'
	* @throw TypeError
	* @return boolean|array     Boolean if $evt is string, array of strings if $evt is RegExp
	*/
	clearEmitted(evt) {
		if (evt instanceof RegExp) {
			return Object.keys(this._betterEvents.emitted)
				.filter((_evt) => { return (_evt.match(evt) ? delete this._betterEvents.emitted[_evt] : false); });
		}
		else if (typeof evt == "string") {
			return (Object.hasOwnProperty.call(this._betterEvents.emitted, evt) ? delete this._betterEvents.emitted[evt] : false);
		}
		else {
			throw new TypeError(errString(1, "evt", evt));
		}
	}

	/*
	* Like addListener, but checks if $evt already has been emitted in which case $callback is called after 1ms (to
	* allow any sync stuff to run first)
	*
	* NOTE: If $evt is currently running $callback runs after all other listeners, ie. ignoring $index on that run
	*
	* @param string|<RegExp> evt    @see addListener()
	* @param function callback      @see addListener()
	* @opt truthy once              @see addListener(). ProTip: use string 'once'
	* @opt number index             @see addListener(). NOTE: will not be respected for previously emitted event
	*
	* @throws TypeError
	* @return object|undefined      If already emitted and $once==true then undefined is returned, else the
	*                                 registered listener object  {e,o,l,i,n,remove,timeout}
	* @any-order
	*/
	after(...args) {
		// Add a listener so we get same handling
		const listener = this.addListener(...args);

		// Now check if it's already been emitted, in which case we manually execute the listener with those arguments now
		const emittedEvt = this.alreadyEmitted(listener.evt);
		if (emittedEvt) {
			// Apply the listener with the args of the emitted event (this returns a promise that always resolves
			// that we don't wait for)
			listener.executeAfter(this.#getEmitAs(), emittedEvt);

			// If we were only supposed to run once, then the listener has no future use so return undefined
			if (listener.once)
				return;
		}
		// This implies that the listener may run again so return it
		return listener;
	}

	/*
	* Like after() but this returns a promise which resolves when callback would have fired first time
	*
	* @param string|<RegExp> evt    @see addListener()
	* @opt number index             @see addListener(). NOTE: will not be respected for previously emitted event
	*
	* @return Promise(mixed,<TypeError>)  Resolves with event payload, rejecets if $evt is bad type
	*/
	afterPromise(evt, index) {
		return new Promise((resolve, reject) => {
			try {
				this.after(evt, (...args) => resolve(args), "once", index);
			}
			catch (err) {
				reject(err);
			}
		});
	}

	/*
	* Create an event that fires once after a list of other events.
	*
	* NOTE: This will fire 1 ms after the last event so that any event listeners can be added before
	*
	* @param string cEvt            Name of new compound event
	* @param array[string] events   List of events to fire after
	*
	* @return object                {fired:{evt1:args,evt3:args},remaining:[evt2,evt4],cancel:f()}
	*
	*/
	createCompoundEvent(cEvt, events) {
		if (typeof cEvt != "string")
			throw new TypeError(errString(1, "s_evt", cEvt));
		if (!events as unknown instanceof Array || !events.length)
			throw new TypeError(errString(2, "an array of events", events));

		// Register listeners after each event we're listening for which stores the emitted data and counts down
		// until all have been emitted, at which time our event is emitted
		// 2019-11-25 DEAR FUTURE ME: don't define the function seperately since we need the 'evt' which
		//                      comes from the forEach()
		let cancelled = false;
		const compound = { fired: {}, remaining: events.slice(0), cancel: () => cancelled = true };
		const listenerEventFailed = new Error(`A listener for compound event '${cEvt}' failed.`);
		const self = this;
		events.forEach(evt => this.after(evt, "once", function executeCompoundEvent(...args) {
			try {
				if (cancelled)
					return;

				// Store the args of this event
				compound.fired[evt] = args;

				// As ^ growns, remaining shrinks...
				compound.remaining.splice(compound.remaining.indexOf(evt), 1);

				// When no more events remain...
				if (!compound.remaining.length) {
					// ...if it has, that means all events have fired and we can now call the passed in listener
					logdebug.call(self, `Running compound event '${cEvt}' now with:`, compound.fired);
					self.emitEvent(cEvt, [compound.fired], undefined, listenerEventFailed);
				}
				else {
					logdebug.call(self, `'${evt}' just ran, but compound event '${cEvt}' is still waiting on: ${compound.remaining.sort()}`);
				}
			}
			catch (err) {
				logwarn.call(self, `Compound event '${cEvt}' will not run.`, err);
				compound.cancel();
			}
		}));

		return compound;
	}

	/*
	* Execute a callback once after all events in a list have been fired.
	*
	* @param array[string] events   List of events to fire after
	* @param function callback      Called with single object. Keys are event names, values are
	*                                arrays of args emitted for that event
	* @opt number timeout           If passed, an event error will be logged if the callback hasn't been called yet
	* @opt bool cancelOnTimeout     If truthy, when timeout fires the listener will be removed from the event
	*
	* @throws TypeError
	* @return object                The registered listener object  {e,o,l,i,n,remove,timeout}
	*/
	afterAll(events: string[], callback: () => {}, timeout?: number, cancelOnTimeout?: boolean): CompoundListener {
		if (!events as unknown instanceof Array || !events.length)
			throw new TypeError(errString(1, "an array of events", events));
		if (typeof callback != "function")
			throw new TypeError(errString(2, "a callback function", callback));

		// Copy to break links from passed in array (so we can always run)
		events = events.slice(0);

		// Check if an compound event for these events has already been created, else do so now
		const cEvt = "compoundEvent_" + events.map(evt => evt.toString()).sort().join("|");
		if (this.getListeners(cEvt, true).length == 0)
			// eslint-disable-next-line no-var
			var compound = this.createCompoundEvent(cEvt, events);

		// Now register the callback
		const listener = this.addListener(cEvt, callback, "once");

		// Create getter which lists the remaining and fired events so we can always check what we're waiting for.
		// If we just created $compound ^ then use the props on it instead of building it here...
		Object.defineProperty(listener, "remaining", {
			enumerable: true
			, get: () => compound
				? compound.remaining.slice(0)
				: events.filter(evt => this.alreadyEmitted(evt) == undefined),
		});
		Object.defineProperty(listener, "fired", {
			enumerable: true
			, get: () => {
				if (compound)
					return Object.assign({}, compound.fired);
				const fired = {};
				for (let evt of events) {
					let _evt = this.alreadyEmitted(evt); // check if it's been emitted (and if a regexp get the actuall evt name)
					if (_evt)
						fired[_evt] = this._betterEvents.emitted[_evt];
				}
				return fired;
			},
		});

		const compoundListener = listener as CompoundListener;

		// If a timeout is passed
		if (typeof timeout == "number") {
			compoundListener.timeout(() => {
				let logstr = (callback.name ? `Callback ${callback.name}()` : "A callback") + ` for ${cEvt}`;
				logstr += (cancelOnTimeout ? " is now cancelled (timed out)" : " hasn't run yet");
				const remaining = compoundListener.remaining;
				if (!remaining.length) {
					logerror.call(this, `BUGBUG: ${logstr}, but all events have fired:`, compoundListener.fired);
				}
				else {
					logerror.call(this, `${logstr} because we are still waiting on ${remaining.length} events: `
					+ `'${remaining.join("','")}'.`);
				}
			}, timeout, cancelOnTimeout);
		}

		return compoundListener;
	}

	/*
	* Add listeners for multiple events, removing all of them once the first runs
	*
	* NOTE: This method will apply .addListener() with every item in arguments, so we're expecting:
	*   [cb1,evt1],[cb2,evt2]
	*
	* NOTE2: By definition 'once' applies to all listeners
	*
	* @return array[<Listeners>...]     Also has secrect method .removeAll()
	*/
	onFirst(...groupedArgs) {
		// Define an array of listeners and a method to remove them all
		const listeners: Listener[] = [];
		const removeListeners = () => {
			try {
				while (listeners.length) {
					const listener = listeners.pop();
					try {
						listener && this.removeListener(listener);
					}
					catch (err) { logerror.call(this, err, listener); }
				}
			}
			catch (err) { logerror.call(this, err); }
		};
		try {
			for (const args of groupedArgs) {
				// Create a listener and add it to our list
				const listener = this.addListener(...args);
				listeners.push(listener);

				// Wrap the callback in another function that removes all other listeners before running
				const cb = listener.callback;
				listener.callback = function (...args) {
					removeListeners();
					return cb(...args);
				};
			}

			// Attach the remove-method to the returned array for ease...
			Object.defineProperty(listeners, "removeAll", { value: removeListeners });

			return listeners;
		}
		catch (err) {
			// Anything goes wrong and we remove any listeners we had time to add, before re-throwing the error
			removeListeners();
			throw err; // rethrow
		}
	}

	/*
	* Works like a hybrid of after() and onFirst(), ie. a single callback runs *after* the first event
	*
	* @return array[<Listeners>...]|undefined     @see .onFirst() or .after()
	*/
	afterFirst(...args) {
		// First add them all...
		const listeners = this.onFirst(...args);

		// ...then check if any have already run
		for (const listener of listeners) {
			const emittedEvt = this.alreadyEmitted(listener.evt);
			if (emittedEvt) {
				listener.executeAfter(this.#getEmitAs(), emittedEvt);

				// Just like with .after() we return undefined here since all the listeners have already been removed
				return;
			}
		}

		return listeners;
	}

	/*
	* Get a list of <Listener>s for one or multiple events, with the caveat that only the first <Listener> with
	* a given callback is returned
	*
	* @param string|<RegExp> evt
	* @opt bool getDuplicates       Default true=>return ALL matching listeners. false=>return the first matching listener
	*                                for each callback
	*
	* @throw TypeError
	* @return array[obj...]
	*/
	getListeners(evt, getDuplicates = true) {
		let listeners, events = this._betterEvents.events;
		if (typeof evt == "string") {
			// Get listeners for the exact event, eg. 'shutdown_network'
			listeners = events[evt] || [];

			// ...+ get listeners that have been registered with a regex to match this event
			// and more, eg. /shutdown_.*/
			this._betterEvents.regexp.forEach((listener) => {
				if (evt.match(listener.evt))
					listeners.push(listener);
			});
		}
		else if (evt instanceof RegExp) {
			const regex = evt;
			listeners = [];
			for (evt in events) {
				if (evt.match(regex))
					listeners = listeners.concat(events[evt]);
			}
		}
		else if (!arguments.length) {
			throw new Error("getListeners() was called without arguments. It needs to be called with an event name or regexp.");
		}
		else {
			throw new TypeError(errString(1, "evt", evt));
		}

		// Either filter away duplicate callbacks or return all of them
		if (getDuplicates) {
			return listeners;
		}
		else {
			listeners.map(l => l.callback).forEach((c, i, arr) => { if (arr.indexOf(c) !== i) { delete listeners[i]; } });
			return listeners.filter(l => l);
		}
	}

	/*
	* Check if an event has any listeners at all
	*
	* @param string|<RegExp> evt
	*
	* @return bool
	*/
	hasAnyListeners(evt) {
		// Quick check if we have any catch-alls...
		// if(this._betterEvents.onAll.length || this._betterEvents.onUnhandled) //2020-10-12: just using regexp now
		if (this._betterEvents.onUnhandled)
			return true;

		// ...then check for specific ones
		return this.getListeners(evt).length > 0;
	}

	/*
	* Check if a specific callback listener is registered for an event
	*
	* @param string|<RegExp>|<Listener> evtOrListner
	* @param function callback
	*
	* @throw TypeError
	* @return bool
	*/
	hasListener(evtOrListner, callback) {
		let t = typeof evtOrListner;
		let nameOrRegex;
		switch (t) {
			case "string":
				nameOrRegex = evtOrListner;
				break;
			case "object":
				if (evtOrListner instanceof RegExp) {
					nameOrRegex = evtOrListner;
				}
				else {
					nameOrRegex = evtOrListner.evt;
					callback = evtOrListner.callback;
				}
				break;
			default:
				throw new TypeError("Expected arg#1 to be a string event name, or an object with prop .evt, got a " + t);
		}
		t = typeof callback;
		let check;
		switch (t) {
			case "string":
				check = listener => listener.callback.name == callback;
				break;
			case "function":
				check = listener => listener.callback == callback;
				break;
			default:
				throw new TypeError("Expected arg#2 to be a string function name or callable function, got a " + t);
		}

		return this.getListeners(nameOrRegex, true).find(check) ? true : false;
	}

	/*
	* Get all events (incl regexp events) or string events matching a given regexp
	*
	* @param @opt <RegExp> evt
	* @throw TypeError
	* @return array[string|<RegExp>]    Array of all registered events
	*/
	getEvents(regexp?: RegExp) {
		let events = [];
		if (regexp instanceof RegExp) {
			var evt;
			for (evt in this._betterEvents.events) {
				if (evt.match(regexp))
					events.push(evt);
			}
		}
		else if (typeof regexp == "undefined") {
			events = events.concat(
				Object.keys(this._betterEvents.events)
				, Object.values(this._betterEvents.regexp).map(([regexp]) => regexp).filter((r, i, a) => a.indexOf(r) == i),
			);
		}
		else {
			throw new TypeError(errString(1, "a <RegExp> or undefined", evt));
		}

		return events;
	}

	/*
	* Removes a single registered evt-listener combo. Ie. if regexp is used, only a registered
	* regexp will be removed, not every event matching that regexp
	*
	* @param <Listener>|function   listener
	* @param string|<RegExp>       evt        Ignored if $listener is <Listener>
	*
	* @throws TypeError
	* @throws Error     If the listener doesn't exist
	*
	* @return <Listener>|undefined      The removed listener object, or undefined
	*/
	removeListener(listener: Listener | ListenerFunction, evt?: string | RegExp) {
		if (listener instanceof Listener) {
			evt = listener.evt;
			listener = listener.callback;
		}
		else if (typeof listener != "function") {
			throw new TypeError(errString(1, "listener", listener));
		}

		// Now get the applicable list of events or regexes <Listeners>
		if (typeof evt == "string")
			// eslint-disable-next-line no-var
			var events = this._betterEvents.events[evt] || [];
		else if (evt instanceof RegExp)
			events = this._betterEvents.regexp;
		else
			throw new TypeError(errString(2, "evt", evt));

		// Now match $listner and $evt
		const i = events.findIndex(obj => obj.callback == listener && String(obj.evt) == String(evt));
		if (i > -1)
			return events.splice(i, 1)[0];

		// Finally, check the unhandled section...
		if (this._betterEvents.onUnhandled && this._betterEvents.onUnhandled.callback == listener) {
			listener = this._betterEvents.onUnhandled;
			this._betterEvents.onUnhandled = null;
			return listener;
		}

		return undefined;
	}

	/*
	* Removes all instances of a listener function from everywhere
	*
	* @param function listener
	*
	* @throws TypeError
	*
	* @return array[string|<RegExp>]    An array of the events the listener was removed from (can be empty)
	*/
	removeListeners(listener) {
		if (typeof listener != "function")
			throw new TypeError(errString(1, "listener", listener));

		const removed = [];
		const remove = function (events) {
			for (let i = events.length - 1; i > -1; i--) {
				if (events[i].callback == listener)
					removed.push(events.splice(i, 1));
			}
		};

		// Loop through all events and remove every <Listener> with .callback==$listener
		Object.values(this._betterEvents.events).forEach(remove);

		// Check regexp...
		remove(this._betterEvents.regexp);

		// Check unhandled
		if (this._betterEvents.onUnhandled.callback == listener) {
			removed.push(this._betterEvents.onUnhandled);
			this._betterEvents.onUnhandled = null;
		}

		// remove(this._betterEvents.onAll,'onAll'); //2020-10-12: just using regexp now

		return removed;
	}

	/*
	* Remove all listeners for a given event. If regexp is passed, all matching _betterEvents.regexp will be
	* removed but _betterEvents.events won't be touched
	*
	* @param string|<RegExp> evt
	*
	* @return array[object]     An array of all the "listener objects" that where removed (may be empty)
	*/
	removeEvent(evt: Evt) {
		const b = this._betterEvents;
		let removed: Listener[] = [];
		if (typeof evt == "string") {
			if (Array.isArray(b.events[evt])) {
				removed = b.events[evt];
				delete b.events[evt];
			}
		}
		else if (evt instanceof RegExp) {
			// Since regexp events are stored as [[],[]] instead of {[],[]}, we have to loop through
			// them all and remove matches
			evt = evt.toString();
			let i;
			for (i = b.regexp.length; i > -1; i--) {
				if (b.regexp[i][0].toString() == evt) {
					removed.push(b.regexp.splice(i, 1));
				}
			}
		}
		else {
			throw new TypeError(errString(1, "evt", evt));
		}
		return removed;
	}

	/*
	* Calls either removeListener or removeEvent depending on if arg#2 is passed or not
	*
	* @param @opt string|<RegExp> evt
	* @param @opt function|object listener
	*
	* @return number   The number of removed listeners
	*/
	off(...args) {
		let evt: Evt;
		let listener: Function;
		let i: number;
		let arg: any;
		for ([i, arg] of Object.entries(args)) {
			if (typeof arg == "function")
				listener = arg;
			else if (typeof arg == "string" || arg instanceof RegExp)
				evt = arg;
			else if (arg instanceof Object && typeof arg.callback == "function")
				listener = arg;

			else
				throw new TypeError(`Expected string, <RegExp>, function or object, arg#${i} was: `
					+ toTypeString(x));
		}
		if (listener) {
			if (!evt && typeof listener == "function") {
				return this.removeListeners(listener).length;
			}
			else {
				return this.removeListener(listener, evt) ? 1 : 0;
			}
		}
		else {
			return this.removeEvent(evt).length;
		}
	}

	/*
	* Register a function to intercept events being emitted. This can either prevent event altogether or
	* change the args being passed to the listners
	*
	* @param string evt
	* @param function interceptor   Will be called as this
	*/
	interceptEvent(evt, interceptor) {
		if (typeof evt != "string")
			throw new TypeError(errString(1, "s_evt", evt));
		if (typeof interceptor != "function")
			throw new TypeError(errString(2, "interceptor", interceptor));

		this._betterEvents.intercept[evt] = interceptor;
	}

	stopIntercepting(evt) {
		if (typeof evt != "string")
			throw new TypeError(errString(1, "s_evt", evt));

		delete this._betterEvents.intercept[evt];
	}

	/*
	* Get an object of listerners ready to be passed to/used by emitEvent().
	*
	* ProTip: This method can be called in advance of emitEvent() and then passed in as the option .listeners
	*         in order to determine ahead of going async which listeners are included
	*
	* @param string|<RegExp> evt
	* @param function|array[function] exclude
	*
	* NOTE: this returns an object, which is un-ordered by def, so the order of the groups is
	*       determined by sorting the keys in numerical order, which is done in _getStatusObj
	*
	* @return object      Keys are indexes, values are arrays of listener objects.
	*                                       { "-1":[{l,i:-1}]
	*                                           ,0:[{l,o,e}]
	*                                           ,1:[{l,o,i,e},{l,o,i,e},...]
	*                                            ,...
	*                                       }
	* @call(this)
	* @private
	*/

	getListenersForEmit(evt: string, exclude: Options["exclude"]): GroupedListeners {
		const listeners = this.getListeners(evt, this._betterEvents.options.allowDuplicates);

		// If no listeners were found, this is an 'unhandled' event, which merits the onUnhandled listener
		if (!listeners.length && this._betterEvents.onUnhandled) {
			// logdebug.call(this,'Adding onUnhandled')
			listeners.push(this._betterEvents.onUnhandled);
		}
		// else{logdebug.call(this,'NOT adding onUnhandled to:',listeners)}

		// 2020-10-12: just using regexp now
		// If onAll has been specified, always add it (will end up first in its group, but unless the group
		// is otherwise empty it will run concurrently with other listeners)
		// if(this._betterEvents.onAll.length){
		//     // logdebug.call(this,'Adding onAll')
		//     listeners=[].concat(this._betterEvents.onAll,listeners)
		// }

		// Remove any we want to exclude
		if (exclude) {
			exclude.forEach((listener) => {
				const i = listeners.findIndex(({ callback }) => callback == listener);
				if (i > -1)
					listeners.splice(i, 1);
			});
		}

		// Group listeners based on their index
		const groupedListeners: GroupedListeners = {};
		Object.defineProperty(groupedListeners, groupedListenerFlag, { value: true, writable: false, enumerable: false, configurable: false }); // secret flag

		listeners.forEach((listener) => {
			(groupedListeners[listener.index] = groupedListeners[listener.index] || []).push(listener);
		});

		return groupedListeners;
	}

	/*
	* Get the object to call each callback with
	*
	* @opt object options
	* @return object
	*/
	#getEmitAs(emitAs?: Options["emitAs"]): object {
		emitAs = emitAs || this._betterEvents.options.emitAs;
		switch (emitAs) {
			case "global":
				return globalObj;
			case "empty":
				return {};
			case undefined:
			case "this":
				return this;
			default:
				if (typeof emitAs == "object") {
					return emitAs;
				}
				else {
					throw new Error("Bad option .emitAs: (" + typeof emitAs + ")" + String(emitAs));
				}
		}
	}

	/**
	* Call all listeners for an event async/concurrently
	*
	* NOTE: Which listeners will be called is determined synchronously when this method is called
	*
	* @param string evt
	* @opt array args
	* @opt object options    Props may include
	*                                exclude - function|array    One or more listeners to exclude
	*                                onProgress - function       A callback called after each change to the returned object
	*                                groupTimeout - number
	*                                returnStatus - boolean     If true this method returns @see _getStatusObj(). The same object
	*                                                           is arg#2 to onProgress() (ie. if you plan to use it's getters you
	*                                                           need to pass true here)
	*                                listeners - array          The results from this.getListenersForEmit(). Emit the event to these
	*                                                           listeners INSTEAD OF calling getListenersForEmit() now.
	* @opt <Error> listenerEventFailed   An error used if the listener failed (good since it's stack can reflect something more telling...)
	*
	* @throws TypeError
	* @return Promise(array[array,...],void)    Resolves when all listeners have finished with an array of arrays. Each child array
	*                                           is in the result from a single listener, in the order they finished (ie. not necessarily
	*                                           the order they were called. Format of child arrays:
	*                                               ['success boolean', 'return value', 'group id', 'in-group id']
	*
	* @return-if object $options.returnStatus==true   @see _getStatusObj(). The above described array is set as prop .results, and the
	*                                                 promise as .promise
	*/
	emitEvent(evt, args?: any[] | any, oneTimeOptions?: Partial<Options>, listenerEventFailed?: Error) {
		// Only allow string events. For emitting all events that match a regexp, use emitEvents()
		if (typeof evt != "string")
			throw new TypeError(errString(1, "s_evt", evt));

		const options = new Options(this._betterEvents.options, oneTimeOptions);
		const prog = options.onProgress; // will always be a func, possibly an empty one
		const groupedListeners = options.listeners || this.getListenersForEmit(evt, options.exclude);
		const status = _getStatusObj(groupedListeners, options.returnStatus);
		const emitAs = this.#getEmitAs(this, options.emitAs); // won't matter if callback is bound

		// Make sure we have an arg array AND delink it from the passed in array (BUT IT DOES NOT delink the individual args)
		args = [].concat(args);
		// NoteToSelf 2020-11-11: Don't change this into an arguments object...

		// Allow possibility to intercept an event...
		if (Object.hasOwnProperty.call(this._betterEvents.intercept, evt)) {
			args = this._betterEvents.intercept[evt].apply(this, args);

			// ...and if it doesn't return an array of new args we classify the event as "intercepted" and we return early
			if (!Array.isArray(args)) {
				status.intercepted = true;
				status.promise = Promise.resolve(status.results);
				prog(evt, status);
			}
		}

		if (!status.intercepted) {
			// REMEMBER: everything in this block is async
			listenerEventFailed = listenerEventFailed ?? new Error(`A listener for event '${evt}' failed.`);
			const _b = this._betterEvents, self = this;
			status.promise = new Promise(async function emitEvent_runListenersAsync(resolve) {
				try {
					// Set event as emitted and running
					_b.emitted[evt] = args;
					if (!_b.running[evt])
						_b.running[evt] = [];
					_b.running[evt].push(status.promise); // is removed at bottom of this promise

					const lastGroup = status.groups.slice(-1);

					// Loop through all groups, calling all listener in them concurrently/asynchronously, then
					// wait for the group to finish before moving on to next group, OR timeout a group if opted
					for (const g of status.groups) {
						const promises = groupedListeners[g].map(async function emitEvent_forEachListener(listener, j) {
							// ^DevNote: remember, since this function is async it will return a promise... ie. we're not actually
							//          awaiting this listener before running the next listener in the same group

							// Sanity check
							if (!(listener instanceof Listener)) {
								const t = typeof listener;
								const err = replaceStack(new Error(`BUGBUG: A ${t} (not an instance of BetterEvents.Listener) was registered `
									+ `as a listener for '${evt}'`), listenerEventFailed);
								console.error(err, listener);
								status.results.push([false, err, g, j]);
								// after this it jumps down and gets status finished...
							}
							else {
								try {
									// Mark and count as running...
									status[g][j] = "executing";
									prog(evt, status, g, j);

									// Then run the listener and add the result to the resolve-array
									const res = await listener.execute(emitAs, args, evt);
									status.results.push([true, res, g, j]);
								}
								catch (err) {
									// logdebug.call(this,err);
									self._betterEvents.onerror(listenerEventFailed, { listener, args: makeArgs(args), options }, err);
									status.results.push([false, err, g, j]);
								}
							}

							status[g][j] = "finished";
							prog(evt, status, g, j);

							return; // Always return, never throw, since these promises are used to determine
							// when all listeners are done
						});

						// ...then wait for them all to finish OR add a timeout
						const groupedPromises = Promise.all(promises);
						if (options.groupTimeout && g != lastGroup) { // last group cannot timeout
							try {
								const timeout = new Promise((nada, expireGroup) => { setTimeout(expireGroup, options.groupTimeout); });
								await Promise.all([groupedPromises, timeout]);
							}
							catch (err) {
								self._betterEvents.onerror(replaceStack(
									new Error(`Group ${g} for event '${evt}' timed out, triggering next group...`)
									, listenerEventFailed,
								));
							}
						}
						else {
							await groupedPromises;
						}

						// If we're delaying between groups...
						if (options.groupDelay && status.groups.length > 1 && g != lastGroup)
							await new Promise((wakeup) => { setTimeout(wakeup, options.groupDelay); });
					}
				}
				catch (err) {
					console.error("BUGBUG - BetterEvents.emitEvent() should have caught and handled all errors, but this got through:", err);
				}

				// Remove from running
				_b.running[evt].splice(_b.running[evt].indexOf(status.promise), 1);

				return resolve(status.results);
			});
			// REMEMBER: ^everything in this block is async
		}

		// Finally (but before all of ^ runs) decide what to return
		if (options.returnStatus) {
			return status;
		}
		else {
			return status.promise;
		}
	}

	/*
	* Trigger all listeners that match a regexp.
	*
	* @param string evt
	* @param @opt array args
	* @param @opt object options
	*
	* @throws TypeError
	* @return Promise(object,n/a)     Keys are events that matched $regexp, values are arrays like this.emit()
	*/
	emitEvents(regexp: RegExp, args, options) {
		if (!regexp as unknown instanceof RegExp)
			throw new TypeError(errString(1, "r_evt", regexp));

		const self = this;
		const listenerEventFailed = new Error(`A listener matching regexp event '${regexp}' failed.`);
		return new Promise(function _emitEvents(resolve) {
			const events = self.getEvents(regexp);

			const results = {}, promises = [];
			for (const evt of events) {
				const obj = self.emitEvent(evt, args, options, listenerEventFailed);
				const promise = obj.promise || obj;// since we don't know if options.returnStatus==true
				promises.push(promise.then((result) => { results[evt] = result; }));
			}

			Promise.all(promises).then(() => resolve(results));
		}).catch((err) => {
			console.error("BUGBUG BetterEvents.emitEvents():", err);
		});
	}

	/*
	* Calls emitEvent or emitEvents with multiple args concated into an array
	*
	* @param string|<RegExp> evt
	*
	* @throw TypeError         If $evt is bad type
	* @return <Promise>                                     Always resolves when all listeners are done, even if some listeners failed
	*
	* @resolves-if(typeof $evt=='string') array[array,...]  Each child array:
	*                                                         [(bool)success,(any)returned value ,(number) group id, (number) within-group id]
	* @resolves-if($evt instanceof RegExp) object           Keys are matching event names, values are arrays-of-arrays like ^
	*/
	emit(evt, ...args) {
		// if(evt=='shutdown'){logdebug.call(this,'emit called',args)}
		const options = { returnStatus: false }; // we don't care about the status object having a bunch of getters since we just want the results
		if (evt instanceof RegExp)
			return this.emitEvents(evt, args, options);
		else if (typeof evt == "string")
			return this.emitEvent(evt, args, options);
		else
			throw new TypeError(errString(1, "evt", evt));
	}

	/*
	* Emit an event once, not doing anything if it's already been emitted
	* @throw TypeError
	* @return Promise(array|void)   Resolves right away with void (if previously emitted), or when emit() resolves
	*/
	emitOnce(evt, ...args) {
		if (!this.alreadyEmitted(evt)) {
			return this.emit.call(this, evt, ...args);
		}
		else {
			return Promise.resolve();
		}
	}
}
