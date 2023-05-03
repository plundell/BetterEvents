
export interface Options {
	groupTimeout?: number;
	groupDelay?: number;
	defaultIndex?: number;
	onProgress?: (...any) => void;
	returnStatus?: boolean;
	listeners?: object;
	onerror?: (...any) => void;
	duplicate?: boolean;
	exclude?: typeof Listener[];
	emitAs?: 'this' | 'global' | 'empty' | 'status';
}
export interface DirtyOptions extends Options {
	duplicates?: boolean;
	exclude?: typeof Listener | typeof Listener[];
}

/**
 * Keys are option names, values are their types. This object is used by parseOptions() to validated
 * passed in dirty options. Note that it doesn't contain all the possible options as some need 
 * futher handling by parseOptions()
 */
const basicOptionTypes = {
	'groupTimeout': 'number',
	'groupDelay': 'number',
	'defaultIndex': 'number',
	'onProgress': 'function',
	'returnStatus': 'boolean',
	'listeners': 'object',
	'onerror': 'function',
};
/**
 * Default options. Used by parseOptions() when creating a new EventEmitter and when emitting an event (with one-time options)
 * 
 * NOTE: additional checks are done for these and other options in parseOptions()
 */
const defaultOptions: Options = {
	groupTimeout: 0 
	, groupDelay: 0 //the amount of time to wait before executing the next group (which can allow things to propogate if need be)
	, defaultIndex: 0
	, onProgress: () => {}
	, duplicate: false   //true=>allow the same listener to be added multiple times. default false
	, returnStatus: true //Default true => emitEvent() will return an object (@see _getStatusObj()), else a promise
};



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
		return `<${'' + value}>`;
	} else {
		let str = value.toString();
		if (str.length > 50)
			str = str.slice(0, 25) + '...' + str.slice(-25);

		let type = typeof value;
		if (type == 'object')
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
		case 'listener': expected = 'a listener function'; break;
		case 'interceptor': expected = 'an interceptor function'; break;
		case 's_evt': expected = 'a string event'; break;
		case 'r_evt': expected = 'a <RegExp> event'; break;
		case 'evt': 
		case 'event':
			expected = 'a string or <RegExp> event'; 
			break;
	}
	return `Arg #${i} should be ${expected}, got: ${toTypeString(value)}`;
}


/**
* Parse options passed to a new instance, only keeping those we expected and only throwing if those are
* the wrong type
*
* @param {Options} dirty   dirty options
* @opt {Options} onetime   one time options
*
* @throws TypeError
*
* @return object        Object of parsed options
*/
export function parseOptions(dirty: DirtyOptions, onetime?: DirtyOptions) {
	dirty = Object.assign({}, dirty, onetime);
	const parsed = Object.assign({}, defaultOptions);
    
        
	for (const key in basicOptionTypes) {
		if (Object.hasOwnProperty.call(dirty, key)) {
			if (typeof dirty[key] == basicOptionTypes[key] && dirty[key] != null)
				parsed[key] = dirty[key];
			else
				throw new TypeError(`Option '${key}' should be a ${basicOptionTypes[key]}, got: ${toTypeString(dirty[key])}`);
		}
	}
	
	if (dirty.exclude) {
		if (typeof dirty.exclude == 'function')
			parsed.exclude = [dirty.exclude];
		else if (Array.isArray(dirty.exclude) && dirty.exclude.every(f => typeof f == 'function'))
			parsed.exclude = dirty.exclude;
		else
			throw new TypeError("Option 'exclude' should be a function or array of functions, got:" + toTypeString(dirty.exclude));
	}

	if (dirty.emitAs) {
		if (['this', 'global', 'empty', 'status'].includes(dirty.emitAs)) {
			parsed.emitAs = dirty.emitAs;
		} else {
			throw new RangeError("Option 'emitAs' should be one of 'this','global','empty','status', got:" + toTypeString(dirty.emitAs)); 
		}
	}

	if (dirty.duplicate || dirty.duplicates) {
		parsed.duplicate = true;
	}

	if (parsed.listeners) {
		if (!parsed.listeners._createdByGetListenersForEmit) {
			throw new Error("Option 'listeners' should be the object returned from getListenersForEmit(), got:"
				+ JSON.stringify(parsed.listeners));
		}
	}
        
	//Wrap progress function so it can't throw
	if (dirty.onProgress)
		parsed.onProgress = function onProgress() { try { dirty.onProgress.apply(this, arguments); } catch (err) { logwarn.call(this, err); } };

	return parsed;
}







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

export interface Status extends CommonStatus {
	[key: string]: GroupStatus | any;
	results: ResultItem[];
	groups: string[];
	intercepted: boolean;
	promise?: Promise<ResultItem[]>
	statusEntries: () => statusEntry[];
	groupsStarted: number;
	groupsDone: number;
	groupsExecuting: number;
	groupsWaiting: number;
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
export function _getStatusObj(groupedListeners, returnStatus) {
	const status: Partial<Status> = {};
	Object.defineProperties(status, {
		'results': { value: [] }  //results in whichever order they finish, child arrays are [true/false, result, i, j]
		, 'groups': { value: Object.keys(groupedListeners).sort() }// <<---------------------------------- this is what decides group order
		, 'intercepted': { value: false, writable: true }
		, 'promise': { writable: true, value: undefined, enumerable: false } 
		//^changed to an actual promise by emitEvent() to return o.results. defined here as non-enum so getters vv don't count it
	});

	Object.defineProperty(status.results, 'get', {
		value: 
			function getResult(g, j) {
				return status?.results?.find(result => result[2] == g && result[3] == j); 
			}
	});

	let l = 0;
	if (status.groups) {	
		for (const g of status.groups) {  //this is the ordered keys
			const group = status[g] = {} as GroupStatus;             //these are the only enumerable props on the status object...
			for (const j in groupedListeners[g]) {
				group[j] = 'waiting';             //...and these the only enumerable on ^
				l++;
			}

			//If opted add getters that get states in the group
			if (returnStatus) { 
				Object.defineProperties(group, {
					'length': { value: Object.keys(group).length }
					, 'listeners': { value: groupedListeners[g] }
					, 'waiting': { get: () => Object.values(group).reduce((sum, state) => sum + (state == 'waiting' ? 1 : 0), 0) }
					, 'executing': { get: () => Object.values(group).reduce((sum, state) => sum + (state == 'executing' ? 1 : 0), 0) }
					, 'finished': { get: () => Object.values(group).reduce((sum, state) => sum + (state == 'finished' ? 1 : 0), 0) }
					, 'started': { get: () => group.length > group.waiting }
					, 'remaining': { get: () => group.length - group.finished }
					, 'progress': { get: () => Math.round(group.finished / group.length * 100) || 0 }
					, 'done': { get: () => group.progress == 100 }
					, 'names': { value: Object.values(groupedListeners[g]).map(listener => listener.callback.name || 'anonymous') }
					, 'statusEntries': { value: () => group.names.map((name, j) => [name, group[j], g, j]) }
					//^DevNote: We call it 'statusEntries' because it kind of works like Object.entries(group) except we're using the name instead of the key
				});
			}
		}
	}
	Object.defineProperty(status, 'length', { value: l });

	//If opted add getters that sum every group to give aggregates
	if (returnStatus) {
		Object.defineProperties(status, {
			'listeners': { value: groupedListeners }
			, 'waiting': { get: () => Object.values(status).reduce((sum, group) => sum + group.waiting, 0) }
			, 'executing': { get: () => Object.values(status).reduce((sum, group) => sum + group.executing, 0) }
			, 'finished': { get: () => status.results.length } //regarless of group, how many listeners have finished
			, 'progress': { get: () => Math.round(status.finished / status.length * 100) || 0 } //of total listeners, how many have finished, 0-100
			, 'done': { get: () => status.progress == 100 }
			, 'names': { get: () => status.groups.map(g => status[g].names).flat() }
			, 'statusEntries': { value: () => status.groups.map(g => status[g].statusEntries()).flat() }

			, 'groupsStarted': { get: () => Object.values(status).reduce((sum, group) => sum + (group.started ? 1 : 0), 0) }
			, 'groupsDone': { get: () => Object.values(status).reduce((sum, group) => sum + (group.done ? 1 : 0), 0) }
			, 'groupsExecuting': { get: () => status.length - status.groupsDone }
			, 'groupsWaiting': { get: () => status.length - status.groupsStarted }
                
		});
	}
	return status;
}

/*
* Get the object to call each callback with
*
* @opt object options
* @return object
*/
export function _getEmitAs(options) {
	options = options || this._betterEvents.options;
	switch (options.emitAs) {
		case 'global':
		case null:
			return globalObj;
		case 'shared':
		case 'empty':
		case 'object':
			return {}; 
		case undefined:
		case 'this':
			return this; 
		default: 
			if (typeof options.emitAs == 'object') {
				return options.emitAs;
			} else {
				throw new Error("Bad option .emitAs: (" + typeof options.emitAs + ")" + String(options.emitAs));
			}
	}
}


/*
* Turn args into an arguments object
* @param array|<arguments>|any
* @return <arguments>
*/
export function makeArgs(args) {
	if (args == undefined) {
		args = [];
	} else if (typeof args == 'object' && args) {
		if (Object.hasOwnProperty.call(args, 'callee') 
			&& Object.hasOwnProperty.call(args, 'length') 
			&& Object.getOwnPropertySymbols(args).map(String) == 'Symbol(Symbol.iterator)'
		) {
			return args;
		} else if (!Array.isArray(args)) {
			args = [args];
		}
	} else {
		args = [args];
	}
	return _makeArgs.apply(this, args);
}
export function _makeArgs() { return arguments; }
