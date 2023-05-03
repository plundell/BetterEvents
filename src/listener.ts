
import { BetterEvents } from "./better_events";


export type ListenerFunction = (...args: any) => void
/**
* @constructor Listener     These are the objects waiting for events to be emitted
*
* @param array args         Array of args
*   @arg string|<RegExp> evt      The event to listen for
*   @arg function listener        Callback to call when $event is emitted. If/when it returns 'off' it will be removed from event
*   @arg boolean|string once      Boolean or string 'once'. The listener will be removed after the first call.  
*   @arg number|string index      The order in which to run the listener. (sometimes called 'group' in this file):
*                                   - Lower numbers run sooner. 
*                                   - All listeners with same index run concurrently. 
*                                   - Use one or multiple '+'/'-' to run in relation to options.defaultIndex
* @param <BetterEvents> emitter 
*/
export class Listener {
	public index: number;
	public once: boolean;
	public callback: ListenerFunction;
	public evt: string | RegExp;
	public runs: number;

	constructor(args, emitter: BetterEvents) {

		//Get the hidden prop from the parent emitter
		const _b = emitter._betterEvents;

		let stack = (args.find((arg: any) => arg instanceof Error) || new Error('Registered from')).stack;
		const str = "at BetterEvents.";
		stack = stack.split("\n").slice(2).map(line => line.trim()).filter(line => line && !line.startsWith(str));

		this.index = _b.options.defaultIndex;
		this.once = false;
		this.runs = 0;

		Object.defineProperties(this, {
			//For legacy we keep the single character props as getters
			i: { get: () => this.index, set: (val) => this.index = val }
			, o: { get: () => this.once, set: (val) => this.once = val }
			, l: { get: () => this.callback, set: (val) => this.callback = val }
			, e: { get: () => this.evt, set: (val) => this.evt = val }
			, n: { get: () => this.runs, set: (val) => this.runs = val }

			//Some synomyms for ease and clarity
			, listener: { get: () => this.callback, set: (val) => this.callback = val }
			, event: { get: () => this.evt, set: (val) => this.evt = val }
			, group: { get: () => this.index }

			, emitter: { writable: true, value: emitter }
			, createdAt: { value: stack[0] }
		});
		

		//First just assign without checking....
		if (args.length == 1 && args[0] && typeof args[0] == 'object') {
			//A single object with named props can be passed in...
			Object.assign(this, args[0]);

		} else { 

			//Allow args in any order
			args.forEach((arg, i) => {
				switch (typeof arg) {
					case 'function': this.callback = arg; break; //listener
					case 'boolean': this.once = arg; break; //once
					case 'number': this.index = arg; break; //index to run
					case 'string': 
						if (arg.match(/^\++$/) && this.index == _b.options.defaultIndex) { //first match => change index, second match =>fall through to this.evt='+'
							this.index = _b.options.defaultIndex + arg.length; //increment index up
						} else if (arg.match(/^-+$/) && this.index == _b.options.defaultIndex) { //first match => change index, second match =>fall through to this.evt='-'
							this.index = _b.options.defaultIndex - arg.length; //increment index down
						} else if (arg == 'once' && this.once == false) {
							this.once = true;
						} else if (!this.evt) {
							this.evt = arg; //event name
						} else {
							throw new Error(`EINVAL. Too many string args passed. Failed on arg #${i} of: ${JSON.stringify(args)}`);
						}
						break;
					case 'object':
						if (arg instanceof RegExp)
							this.evt = arg;
						else
							throw new Error(`EINVAL. Unexpected object arg #${i}. Only event <RegExp> or single object matching return of this method allowed: `
								+ JSON.stringify(this));
				}
			});
		}

		//Then check...
		if (typeof this.callback != 'function')
			throw new TypeError("No listener function passed, got: " + JSON.stringify(this));
		if (typeof this.evt != 'string' && !(this.evt instanceof RegExp))
			throw new TypeError("No event string or RegExp was passed, got: " + JSON.stringify(this));
	}


	//Finally, add a method that can always be used to remove this listener from this object...
	remove() {
		try {
			emitter.removeListener(this.callback, this.evt);
			return true;
		} catch (e) {
			return false; //the listener had previously been removed
		}
	}

	//...and one that can be used to add a timeout that fires if the event hasn't fired within that timespan
	timeout(callback, timeout, cancelOnTimeout) {
		const n0 = this.runs; //run times when timeout is registered...
		return setTimeout(() => {
			//...compared to run times on timeout
			if (this.runs == n0) {
				if (cancelOnTimeout)
					this.remove();
				callback.call(emitter);
			}
		}, timeout);
	}

	        
	/*
	* Execute (.apply) the callback
	*
	* @param object callAs
	* @param array args
	* @opt string evt       The event that caused this to run. only relevant if this.evt is regexp
	*
	* @return Promise(result,error)       
	*/        
	execute(callAs, args, evt) {
		return new Promise((resolve, reject) => {
			//Make sure that the callback runs async (allowing any sync calls after it to run first)
			setTimeout((async function _execute() { 
				try { 
					//Increment counter
					this.runs++;

					//Remove from emitter BEFORE since the callback may emit the event again
					if (this.once)
						this.remove();

					//If our .evt is a RegExp, and a specific event is used to apply (ie. the regular behaviour of emitEvent()),
					//prepend that event to the args
					if (typeof this.evt != 'string' && typeof evt == 'string')
						args = [evt].concat(args);                     

					//Now run the callback which may return a value or a promise...
					const result = await this.callback.apply(callAs, args);

					//The return value may be reason to remove it...
					if (result == 'off')
						this.remove();
					//^DevNote: the 'off' is meant for here, but we pass it on anyway for potential logging purposes

					//Finally we return what may be a promise or may be a value
					return resolve(result);

				} catch (err) {
					reject(err);
				}
			}).bind(this), 0);
		});
	}


	/*
	* @param string emittedEvt
	* @return Promise(void,n/a);
	*/
	executeAfter(emittedEvt) {
		//Get possible pending promise for a currently running event
		let running = emitter._betterEvents.running[emittedEvt];
		if (running)
			running = running.slice(-1);

		let args;
		const listenerEventFailed = new Error(`Listener executed after ${emittedEvt} failed.`);
	            
		return Promise.resolve(running)
			.then(() => {
				//get the args the emitted last
				args = emitter._betterEvents.emitted[emittedEvt];

				this.execute(_getEmitAs.call(emitter), args, emittedEvt);
			})
			.catch((err) => {
				emitter._betterEvents.onerror(listenerEventFailed, { listener: this, args: makeArgs(args) }, err);
			})
			;
	}
	


	toString() {
		const created = this.createdAt.split("\n")[0].trim().replace(/^at\s+/, '');
		return `<Listener event:${this.evt} registered:${created}>`;
	}

}














