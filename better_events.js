//simpleSourceMap=/my_modules/better_events.js
//simpleSourceMap2=/lib/better_events.js
;'use strict';
/**
 * @module BetterEvents
 * @author plundell 
 * @email qmusicplayer@protonmail.com
 * @license MIT
 * @description Advanced event emitter for NodeJS and browsers. 
 *
 * This file can be 'required' or loaded directly in browser with <script src="/path/to/better_events.js">
 */
(function(globalObj){
    
    //Export from module if available
    if(typeof module === 'object' && module.exports){
        module.exports = BetterEvents;
    }

    //Set on window if available
    if(typeof window === 'object'){
        window.BetterEvents=BetterEvents;
    }
    


    const defaultOptions={
        bufferDelay:1000
        ,groupTimeout:0 
        ,defaultIndex:0
        ,onProgress:()=>{}
        ,runAs:'this'       //Available: this, global, empty=>an empty object,shared=>a shared new object, status=>the object returned by emitEvent
    }

    function BetterEvents(options={}){
        
        //Make sure we've been new'ed
        if(!this instanceof BetterEvents)
            throw new Error("BetterEvents() should be new'ed or called as object which inherits from BetterEvents");


        Object.defineProperty(this,'_betterEvents',{value:{
            emitted:{}
            ,after:{}
            ,buffer:{}
            ,intercept:{}
            ,options:parseOptions(options)
            ,onerror:typeof options.onerror=='function'
                ?options.onerror
                :BetterEvents.prototype._defaultEmitErrorHandler
        }});
        

        this.removeAllListeners(); //resets/sets default values of additional properties on this._betterEvents
    }

    /*
    * This method can be changed to another function to set the default value
    * for each instance subsequently created.
    */
    BetterEvents.prototype._defaultEmitErrorHandler=console.error;


    /*
    * Removes all listeners for all events
    * @return this
    */
    BetterEvents.prototype.removeAllListeners = function(){
        this._betterEvents.events={};
        this._betterEvents.regexp=[];
            //^Just like events^, one regexp can have multiple listeners, but regexps are objects so can't
            // be keys, and we don't want to use a Map since we want to compare their toString()s, so we
            // will store them on array as [[regex1,func1],[regex2,func2],...]
        this._betterEvents.onAll=[];
        this._betterEvents.onUnhandled=null;
        return this;
    };




    /*
    * Turn any value into a string suitable to put into an error msg
    *
    * @param any value
    *
    * @return string    Finite length string (max ~70 characters)
    * @private
    */
    function typeString(value){
        if(value==null || value==undefined){
            return `<${''+value}>`
        }else{
            var str=value.toString();
            if(str.length>50)
                str=str.slice(0,25)+'...'+str.slice(-25)
            var type=typeof value;
            if(type=='object')
                type=value.__proto__.constructor.name
            return `(${type})${str}`
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
    function errString(i,expected,value){
        switch(expected){
            case 'listener': expected='a listener function'; break;
            case 'interceptor': expected='an interceptor function'; break;
            case 's_evt': expected='a string event'; break;
            case 'r_evt': expected='a <RegExp> event'; break;
            case 'evt': 
            case 'event':
                expected='a string or <RegExp> event'; break;
        }
        return `Arg #${i} should be ${expected}, got: ${typeString(value)}`;
    }



    function parseOptions(a,b){
        var dirty=Object.assign({},a,b);
        var parsed=Object.assign({},defaultOptions);
        
        if(dirty.bufferDelay){
            if(typeof dirty.bufferDelay=='number')
                parsed.bufferDelay=dirty.bufferDelay;
            else
                throw new TypeError("Option 'bufferDelay' should be a number, got:"+typeString(dirty.bufferDelay))
        }

        if(dirty.groupTimeout){
            if(typeof dirty.groupTimeout=='number')
                parsed.groupTimeout=dirty.groupTimeout;
            else
                throw new TypeError("Option 'groupTimeout' should be a number, got:"+typeString(dirty.groupTimeout))
        }


        if(dirty.onProgress){
            if(typeof dirty.onProgress=='function')
                parsed.onProgress=dirty.onProgress;
            else
                throw new TypeError("Option 'onProgress' should be a function, got:"+typeString(dirty.onProgress))
        }

        if(dirty.exclude){
            if(typeof dirty.exclude=='function')
                parsed.exclude=[dirty.exclude];
            else if(Array.isArray(dirty.exclude) && dirty.exclude.all(f=>typeof f=='function'))
                parsed.exclude=dirty.exclude;
            else
                throw new TypeError("Option 'exclude' should be a function or array of functions, got:"+typeString(dirty.exclude))
        }

        if(dirty.emitAs){
            if(Array('this','global','empty','status').includes(dirty.emitAs)){
                parsed.emitAs=dirty.emitAs
            }else{
               throw new RangeError("Option 'emitAs' should be one of 'this','global','empty','status', got:"+typeString(dirty.emitAs)); 
            }
        }

        return parsed;
    }



    /*
    * Add a listener for a specific event, or using regexp for an unspecified number of possible events.
    *
    * NOTE: Duplicate listeners for the same event cannot be added. Will return current index if attempted
    * NOTE2: If using regexp, duplicate listener calls will be avoided when emitting
    * NOTE3: If any listeners in a 'sooner' group returns a Promise that never resolves, then no later groups will run!
    * NOTE4: Params can be passed in any order
    *
    * @param string|<RegExp> evt    Reserved values are 'once' and only '-' or '+'
    * @param function listener      Method to be called when the event is emitted. If the method returns 'off' on
    *                                any call then it will be removed after that call
    * @opt boolean|string once      Boolean or string 'once'. The listener will be removed after the first time it's called.  
    *                                ProTip: is to use string 'once' so it's clear what we're doing...
    * @opt number|string index      The order in which to run the listener. All listeners with same index run
    *                                 concurrently. Lower numbers run sooner. Use one or multiple '+'/'-' to run in relation
    *                                 to options.defaultIndex
    *
    *
    * @throw TypeError
    * @return object        {e,o,l,i,r}   
    */
    BetterEvents.prototype.addListener=function(...args) {
        
        var _b=this._betterEvents;
        var obj={o:false, i:_b.options.defaultIndex};

        //Allow args in any order
        args.forEach(arg=>{switch(typeof arg){
            case 'function':obj.l=arg; break;
            case 'boolean':obj.o=arg; break;
            case 'number':obj.i=arg; break;
            case 'string': 
                if(arg.match(/^\++$/)){
                    obj.i=_b.options.defaultIndex+arg.length; 
                }else if(arg.match(/^\-+$/)){
                    obj.i=_b.options.defaultIndex-arg.length; 
                }else{
                    obj.e=arg;
                }
                break;
            case 'object':
                if(arg instanceof RegExp)
                    obj.e=arg
                else
                    obj=arg;
        }})

        if(typeof obj.l!='function')
            throw new TypeError("No listener function passed, got: "+JSON.stringify(obj));


        if(typeof obj.e=='string'){
            if(_b.events.hasOwnProperty(obj.e)){
                var _obj=_b.events[obj.e].find(({l})=>l===obj.l)
                if(_obj)
                    obj=_obj
                else
                    _b.events[obj.e].push(obj)
            }else{
                _b.events[obj.e]=[obj];
            }

        }else if(obj.e instanceof RegExp){
            //If the exact combo has already been added, don't duplicate, however getListeners() used by
            //emitEvent() will return a unique array so no need to panic here
            var _obj=_b.regexp.find(({l,e})=>l===obj.l && e==obj.e)
            if(_obj)
                obj=_obj;
            else
                _b.regexp.push(obj)
        }else{
            throw new TypeError("No event string or RegExp was passed, got: "+JSON.stringify(obj));
        }

        //Finally, add a method that can always be used to remove this listener from this object
        obj.r=this.removeListener.bind(this,obj.l,obj.e);

        return obj;
    };

    /*
    * @shortcut addListener(,,false)   
    * @return object        {e,o,l,i}
    */
    BetterEvents.prototype.on=function(evt,listener){
        return this.addListener(evt,listener,false);
    }

    /*
    * @shortcut addListener(,,true)
    * @return object        {e,o,l,i}
    */
    BetterEvents.prototype.once=function(evt,listener){
        return this.addListener(evt,listener,true);
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
    BetterEvents.prototype.onUnhandled=function(listener){
        if(listener===false || listener===null){
            this._betterEvents.onUnhandled=null;
            return false;
        }else if(typeof listener!='function')
            throw new TypeError(errString(1,'listener',listener));

        //NOTE: this object has no 'e' prop, which means that emitEvent() will call it
        //with the evt string as first arg and it will be ignored by removeEvent()

        this._betterEvents.onUnhandled={l:listener};

        return;
    }

    /*
    * Add a listener for all events without preventing listener set by this.onUnhandled().
    *
    * PROTIP: If you what to prevent onUnhandled, try using a catch-all regex, eg. addListener(/./,()=>{...})
    *
    * NOTE: Listeners added this way can still be excluded when emitting
    * NOTE2:Listeners added this way ARE NOT CHECKED FOR DUPLICATE against those set with addListener
    * NOTE3:Listeners added this way can still be removed with removeListeners()
    *
    * @param function|false listener    False removes any set listener
    * @param @opt number index          @see defaultIndex. The order in which to run the listener.
    *
    * @return object|false        {l,i}
    */
    BetterEvents.prototype.onAll=function(listener,index=undefined){
        if(typeof listener!='function')
            throw new TypeError(errString(1,'listener',listener));

        var _b=this._betterEvents, obj=_b.onAll.find(obj=>obj.l==listener);
        if(obj){
            //If it already exists, just change the number if another is given here
            if(typeof index=='number')
                obj.i=index;
        }else{
            //NOTE: this object has no 'e' prop, which means that emitEvent() will call it
            //with the evt string as first arg and it will be ignored by removeEvent()

            _b.onAll.push({l:listener,i:(typeof index=='number' ? index : _b.options.defaultIndex)});
        }

        return;
    }




    /*
    * Check if an event has already been emitted
    *
    * @param string|<RegExp> evt   NOTE: A regex will be used to match regular events, it will not match
    *                               the string version of itself, eg. '/test/'
    *
    * @return string|undefined    The name of the first matching emitted event, or undefined
    */
    BetterEvents.prototype.alreadyEmitted=function alreadyEmitted(evt){
        if(evt instanceof RegExp){
            return Object.keys(this._betterEvents.emitted)
                .find(_evt=>_evt.match(evt))
        }else if(typeof evt=='string'){
            return this._betterEvents.emitted.hasOwnProperty(evt)?evt:undefined;
        }else{
            throw new TypeError(errString(1,'evt',evt));
        }
    }

    /*
    * Remove stored emitted events. This will affect emitOnce(), alreadyEmitted() and after()
    *
    * @param string|<RegExp> evt   NOTE: A regex will be used to match regular events, it will not match
    *                               the string version of itself, eg. '/test/'
    * @throw TypeError
    * @return boolean|array     Boolean if $evt is string, array of strings if $evt is RegExp
    */
    BetterEvents.prototype.clearEmitted=function(evt){
        if(evt instanceof RegExp){
            return Object.keys(this._betterEvents.emitted)
                .filter(_evt=>{return (_evt.match(evt) ? delete this._betterEvents.emitted[_evt] : false)})
        }else if(typeof evt=='string'){
            return (this._betterEvents.emitted.hasOwnProperty(evt) ? delete this._betterEvents.emitted[evt] : false);
        }else{
            throw new TypeError(errString(1,'evt',evt));
        }
    }



    /*
    * Like addListener, but checks if $evt it has already been emitted and triggers $listener immediately
    * in that case
    *
    * NOTE: This doesn't wait for other listeners for $evt to finish running before running $listener
    *
    * @param string|<RegExp> evt    @see addListener()
    * @param function listener      @see addListener()
    * @opt truthy once              @see addListener(). ProTip: use string 'once'
    * @opt number index             @see addListener(). NOTE: will not be respected for previously emitted event
    *                                 
    * @throws TypeError
    * @return object|undefined      If already emitted and $once==true then undefined is returned, else the 
    *                                 registered listener object  {e,o,l,i,r}
    */
    BetterEvents.prototype.after=function after(evt,listener,once,index){
        //First we check if it's been emitted. If evt is regex, then _evt will be the
        //string of the first matched emitted event.
        var _evt=this.alreadyEmitted(evt);

        //Then we possibly add it
        if(!_evt || !once)
            var ret=this.addListener(evt,listener,once,index);
             //^if evt is regexp, this listener will fire every time a matching event is emitted

        //Then we possibly emit right away
        if(_evt){
            try{
                var args=this._betterEvents.emitted[_evt]
                
                //if evt is regexp, then the listener is expecting _evt to be the first arg, just 
                //like it would/will when called from emitEvent, however the stored args will
                //not contain the event, so we need to do the same thing here that we do in emitEvent()
                if(evt instanceof RegExp)
                    args=[_evt].concat(args);

                listener.apply(this,args);
            }catch(err){
                this._betterEvents.onerror(`after() event listener '${_evt}' failed:`,err
                        ,'Called with args:',args)
            }
        }

        return ret;
    }

    


    /*
    * Execute a callback once after all events in a list have been fired. 
    *
    * @param array events
    * @param function callback  Called with single object. Keys are event names, values are 
    *                           arrays of args emitted for that event
    *
    * @throws TypeError
    * @return void
    */
    BetterEvents.prototype.afterAll=function(events,callback){
        if(!events instanceof Array)
            throw new TypeError(errString(1,'an array of events',events));
        if(typeof callback!='function')
            throw new TypeError(errString(2,'a callback function',callback));

        //Register a listener which stores each emitted event's args and counts down until our
        //callback can be called. 
        //2019-11-25 DEAR FUTURE ME: don't define the function seperately since we need the 'evt' which
        //                      comes from the forEach()
        var callbackArgs={},remaining=events.length;
        events.forEach(evt=>this.after(evt,(...args)=>{
            callbackArgs[evt]=args;

            //...then decrement the counter and check if it's reached zero...
            remaining--;
            if(remaining<1){
                //...if it has, that means all events have fired and we can now call the passed in listener
                try{
                    // console.log(callback);
                    callback.call(this,callbackArgs);
                }catch(err){
                    console.log(err);
                    // this._betterEvents.onerror(err);
                }
            }

        },true));
       
        return;
        
    }









    /*
    * Get a single unique list of listeners for one or multiple events
    *
    * @param string|<RegExp> evt 
    *
    * @throw TypeError
    * @return array[function]   
    */
    BetterEvents.prototype.getListeners=function(evt){

        var listeners;
        if(typeof evt=='string'){
            //Get listeners for the exact event, eg. 'shutdown_network'
            listeners=this._betterEvents.events[evt] || [];

            //...+ get listeners that have been registered with a regex to match this event 
            //and more, eg. /shutdown_.*/
            this._betterEvents.regexp.forEach(listener=>{
                if(evt.match(listener.e))
                    listeners.push(listener);
            })
        }else if(evt instanceof RegExp){
            var regex=evt,events=this._betterEvents.events;
            listeners=[];
            for(evt in events){
                if(evt.match(regex))
                    listeners=listeners.concat(events[evt]);
            }
        }else{
            throw new TypeError(errString(1,'evt',evt));
        }

        //Get unique array
        listeners=listeners.filter((listener,i)=>listeners.indexOf(listener)==i);

        return listeners;
    }


    /*
     * Count the number of listeners for a given event
     *
     * @param string|<RegExp>   evt             
     * @param @opt boolean countUnhandled   Default false. If true, will return -1 if only an onUnhandled/onAll listener 
     *                                       exists for this listener
     *
     * @return number               
     */
    BetterEvents.prototype.countListeners = function countListeners(evt, countCatchAll=false) {
        let l=this.getListeners(evt).length

        if(l)
            return l+this._betterEvents.onAll.length;
        else if(countCatchAll && (this._betterEvents.onUnhandled||this._betterEvents.onAll.length))
            return -1*(this._betterEvents.onAll.length+(this._betterEvents.onUnhandled?1:0));
        else 
            return 0;
    }

    /*
    * Check if an event has any listeners at all
    *
    * @param string|<RegExp> evt 
    *
    * @return bool            
    */
    BetterEvents.prototype.hasAnyListeners = function hasAnyListeners(evt) {
        //Quick check if we have any catch-alls...
        if(this._betterEvents.onAll.length || this._betterEvents.onUnhandled)
            return true;

        //...then check for specific ones
        return this.hasListener(evt);
    }


    /*
    * Check if an event has a specific listener
    * 
    * @param string|<RegExp> evt 
    * @param function listener
    *
    * @throw TypeError
    * @return bool            
    */
    BetterEvents.prototype.hasListener = function hasListener(evt,listener) {
        switch(typeof listener){
            case 'function':
                return this.getListeners(evt).find(obj=>obj.l==listener) ? true : false;
            case 'object':
                if(listener.hasOwnProperty('l') && typeof listener.l =='function'){
                    return this.getListeners(evt).includes(listener);
                }
                //Else let fall through
            default:
                throw new TypeError("Expected listener function or object returned by hasListener(), got: "+String(listener));
        }
    }






    /*
    * Get all events (incl regexp events) or string events matching a given regexp
    *
    * @param @opt <RegExp> evt
    * @throw TypeError
    * @return array[string|<RegExp>]    Array of all registered events
    */
    BetterEvents.prototype.getEvents=function(regexp=undefined){
        var events=[];
        if(regexp instanceof RegExp){
            var evt;
            for(evt in this._betterEvents.events){
                if(evt.match(regexp))
                    events.push(evt);
            }

        }else if(typeof regexp == 'undefined'){
            events=events.concat(
                Object.keys(this._betterEvents.events)
                ,Object.values(this._betterEvents.regexp).map(([regexp])=>regexp).filter((r,i,a)=>a.indexOf(r)==i)
            );

        }else{
            throw new TypeError(errString(1,'a <RegExp> or undefined',evt));
        }

        return events
            
    }





    /*
    * Removes a single registered evt-listener combo. Ie. if regexp is used, only a registered
    * regexp will be removed, not every event matching that regexp
    *
    * @param object|function listener   A listener function, or an object with props e and l
    * @param @opt string|<RegExp> evt
    *
    * @throws TypeError
    * @throws Error     If the listener doesn't exist
    *
    * @return {e,o,l,i}|undefined      The removed listener objects, or undefined
    */
    BetterEvents.prototype.removeListener=function(listener,evt){
        // console.log('REMOVING',listener,evt);
        if(listener instanceof Object && evt==undefined){
            if(!listener.e){
                // console.log('non-standard listener:',arguments)
                return undefined //ie. a non-standard listener, not stored on .events or .regexp
            }

            evt=listener.e
            listener=listener.l
        }

        var arr;
        if(typeof evt=='string')
            if(this._betterEvents.events[evt] instanceof Array)
                arr=this._betterEvents.events[evt]
            else
                throw new Error("No such event: "+evt);
        else if(evt instanceof RegExp)
            arr=this._betterEvents.regexp;
        else
            throw new TypeError(errString(2,'evt',evt));


        let i=arr.findIndex(({e,l})=>l==listener && e==evt);
        if(i>-1){
            // console.log("Removing ", arr[i])
            return (arr.splice(i,1))[0];
        }
        else
            throw new Error("No such listener: "+typeString(listener));


    }

    /*
    * Removes all instances of a listener function from everywhere
    *
    * @param function listener
    *
    * @throws TypeError
    *
    * @return array[string|<RegExp>]    An array of the events the listener
    *                                   was removed from (can be empty)
    */
    BetterEvents.prototype.removeListeners=function(listener){
        if(typeof listener !='function')
            throw new TypeError(errString(1,'listener',listener));
        
        var events=[];

        function remove(arr, evt){
            var i=arr.length-1;
            for(i;i>=0;i--){
                if(arr[i].l==listener){
                    events.push(evt||arr[i].e);
                    arr.splice(i,1);
                }
            }
        }

        this._betterEvents.events.forEach(remove)

        remove(this._betterEvents.regexp);
        remove(this._betterEvents.onAll,'onAll');

        if(this._betterEvents.onUnhandled.l==listener){
            events.push('onUnhandled');
            this._betterEvents.onUnhandled=null;
        }

        return events
    }


    /*
    * Remove all listeners for a given event. If regexp is passed, all matching _betterEvents.regexp will be
    * removed but _betterEvents.events won't be touched
    *
    * @param string|<RegExp> evt
    *
    * @return array[object]     An array of all the "listener objects" that where removed (may be empty)
    */
    BetterEvents.prototype.removeEvent=function(evt){
        let b=this._betterEvents, removed=[];
        if(typeof evt=='string'){
            if(Array.isArray(b.events[evt])){
                removed=b.events[evt];
                delete b.events[evt];
            }
        }else if(evt instanceof RegExp){
            //Since regexp events are stored as [[],[]] instead of {[],[]}, we have to loop through
            //them all and remove matches
            evt=evt.toString();
            var i;
            for(i=b.regexp.length; i>-1;i--){
                if(b.regexp[i][0].toString()==evt){
                    removed.push(b.regexp.splice(i,1))
                }
            }
        }else{
            throw new TypeError(errString(1,'evt',evt));
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
    BetterEvents.prototype.off=function(){
        var evt,listener,i,x;
        for([i,x] of Object.entries(arguments)){
            if(typeof x=='function')
                listener=x;
            else if(typeof x=='string'||x instanceof RegExp)
                evt=x;
            else if(x instanceof Object && typeof x.l=='function')
                listener=x;

            else
                throw new TypeError(`Expected string, <RegExp>, function or object, arg#${i} was: `
                    +typeString(x));
        }
        if(listener){
            if(!evt && typeof listener=='function'){
                return this.removeListeners(listener).length;
            }else{
                return this.removeListener(listener,evt) ? 1 : 0;
            }
        }else{
            return this.removeEvent(evt).length;
        }

    }






    BetterEvents.prototype.interceptEvent=function(evt,interceptor){
        if(typeof evt !='string')
            throw new TypeError(errString(1,'s_evt',evt));
        if(typeof interceptor !='function')
            throw new TypeError(errString(2,'interceptor',interceptor));

        this._betterEvents.intercept[evt]=interceptor;
    }

    BetterEvents.prototype.stopIntercepting=function(evt){
        if(typeof evt !='string')
            throw new TypeError(errString(1,'s_evt',evt));

        delete this._betterEvents.intercept[evt];
    }










    /*
    * For internal use by emitEvent. Will add onAll and onUnhandled listeners to $listeners array
    *
    * @param string|<RegExp> evt
    * @param function|array[function] exclude
    *
    * NOTE: this returns an object, which is un-ordered by def, so the order of the groups is 
    *       determined by sorting the keys in numerical order, which is done in _getStatusObj
    *
    * @return object      Keys are indexes, values are arrays listener objects.
    *                                       { "-1":[{l,i:-1}]
    *                                           ,0:[{l,o,e}]        
    *                                           ,1:[{l,o,i,e},{l,o,i,e},...] 
    *                                            ,...
    *                                       }
    * @call(this)
    * @private
    */
    function _getGroupedListeners(evt,exclude){
if(evt=='settings') console.log('_getGroupedListeners exclude:',exclude)

        var listeners=this.getListeners(evt)

        //If no listeners were found, this is an 'unhandled' event, which merits the onUnhandled listener
        if(!listeners.length && this._betterEvents.onUnhandled ){
            // console.log('Adding onUnhandled')
            listeners.push(this._betterEvents.onUnhandled)
        }
        // else{console.log('NOT adding onUnhandled to:',listeners)}

        //If onAll has been specified, always add it (will end up first in its group, but unless the group
        //is otherwise empty it will run concurrently with other listeners)
        if(this._betterEvents.onAll.length){
            // console.log('Adding onAll')
            listeners=[].concat(this._betterEvents.onAll,listeners)
        }

         //Remove any we want to exclude (parseOptions should have made sure it's an array)
        if(exclude){
            exclude.forEach(listener=>{
                let i=listeners.findIndex(({l})=>l==listener)
                if(i>-1)
                    listeners.splice(i,1);
            })
        }

        //Group listeners based on their index
        var groups={};
        listeners.forEach(listener=>{
            let i=(listener.hasOwnProperty('i')?listener['i']:0);
            (groups[i]=groups[i]||[]).push(listener)
        })

        return groups;
    }



    /*
    * @param object groups  The object returned by _getGroupedListeners()
    * @opt boolean simple   Default false. If true the returned object will lack all bells and whistles
    * @return object        The object populated and then returned by emitEvent
    * @private
    */
    function _getStatusObj(groups,simple=false){
        let o={};
        Object.defineProperties(o,{
            'results':{value:[]}
            ,'groups':{value:Object.keys(groups).sort()}// <<---------------------------------- this is what decides group order
        });

        for(let i in groups){
            o[i]={};
            for(let j in groups[i]){
                o[i][j]='waiting';
            }
            if(!simple){ 
                //Add sum'ers for states in the group
                Object.defineProperties(o[i],{
                    'length':{value:Object.keys(o[i]).length}
                    ,'listeners':{value:groups[i]}
                    ,'waiting':{get:()=>Object.values(o[i]).reduce((sum,state)=>sum+(state=='waiting'?1:0),0)}
                    ,'executing':{get:()=>Object.values(o[i]).reduce((sum,state)=>sum+(state=='executing'?1:0),0)}
                    ,'finished':{get:()=>Object.values(o[i]).reduce((sum,state)=>sum+(state=='finished'?1:0),0)}
                    ,'started':{get:()=>o[i].length>o[i].waiting}
                    ,'remaining':{get:()=>o[i].length-o[i].finished}
                    ,'done':{get:()=>o[i].executing==0&&o[i].started}
                    ,'progress':{get:()=>o[i].finished/o[i].length}
                    ,'names':{value:Object.values(groups[i]).map(obj=>obj.l.name||'anonymous')}
                    ,'entries':{get:()=>o[i].names.map((name,j)=>[name,o[i][j],i,j])}
                     //^use this last one to get list of unfinished funcs... or better yet use the aggregate one vv
                })
            }

        }

        if(!simple){
            Object.defineProperties(o,{
                'length':{value:Object.values(o).reduce((sum,group)=>sum+group.length,0)}
                ,'listeners':{value:groups}
                ,'waiting':{get:()=>Object.values(o).reduce((sum,group)=>sum+group.waiting,0)}
                ,'executing':{get:()=>Object.values(o).reduce((sum,group)=>sum+group.executing,0)}
                ,'finished':{get:()=>o.results.length}
                ,'progress':{get:()=>o.finished/o.length}
                ,'groupsStarted':{get:()=>Object.values(o).reduce((sum,group)=>sum+(group.started?1:0),0)}
                ,'groupsDone':{get:()=>Object.values(o).reduce((sum,group)=>sum+(group.done?1:0),0)}
                ,'groupsExecuting':{get:()=>o.length-o.groupsDone}
                ,'groupsWaiting':{get:()=>o.length-o.groupsStarted}
                ,'entries':{get:()=>{
                    var entries=[];
                    for(let i of Object.keys(o)){
                        o[i].entries.forEach(entry=>{
                            entry.push(i);
                            entries.push(entry);
                        })
                    }
                    return entries;
                }}
                ,'intercepted':{value:false, writable:true}
            })
        }

        return o;
    }









    /**
    * Call all listeners for an event async/concurrently
    *
    * @param string evt
    * @param @opt array args
    * @param @opt object options    Props may include
    *                                exclude - function|array    One or more listeners to exclude
    *                                onProgress - function       A callback called after each change to the returned object
    *                                groupTimeout - number      
    *                                simple - boolean            If true, only status.promise will be returned, and any progress
    *                                                             callback will only get simple status object as arg#2
    *
    * @throws TypeError
    * @return object        @see _getStatusObj() + additional properties:
    *                           results - array[array...] The response from each listener, in whatever order they finish, 
    *                                                      good/bad/undefined all mixed together. Child arrays contain:
    *                                                        ['success boolean', 'return value', 'group id', 'in-group id']
    *                           promise - <Promise>       Resolves (always) with $results after ALL listeners have run 
    *                                                       to end.
    *
    * @return-if($options.simple==true) promise                              
    */
    BetterEvents.prototype.emitEvent = function(evt, args=undefined, options=undefined) {
        //Only allow string events. For emitting all events that match a regexp, use emitEvents()
        if(typeof evt!='string')
            throw new TypeError(errString(1,'s_evt',evt));

        var _b=this._betterEvents
        options=parseOptions(_b.options,options)
        var prog=options.onProgress; //will always be a func, possibly an empty one


        var groups=_getGroupedListeners.call(this,evt,options.exclude);
        var status=_getStatusObj(groups,options.simple); //<-- this is the object returned

        //Determine what all the emitters will be called as (remember, if they've bound to something else, this won't matter)
        switch(options.emitAs){
            case 'global':
                options.emitAs=globalObj; break;
            case 'shared':
                options.emitAs={}; break;
            case 'status':
                options.emitAs=status; break;
            case 'empty':
                Object.defineProperty(options,'emitAs',{get:()=>{return {};}}); break;
            default: //there should be no other choises... but whatever
            case 'this':
                options.emitAs=this; break;
        }
        // console.log('EMITTING:',evt)
        //Make sure we have an array. This also copies delinks it from the passed in array
        args=[].concat(args);

        //Allow possibility to intercept an event, either changing the args or preventing it from propogating at all
        if(_b.intercept.hasOwnProperty(evt)){
            args=_b.intercept[evt](args);
            if(!Array.isArray(args)){
                status.intercepted=true;
                prog(evt,status);
            }
        }

        var self=this
        var allDone= new Promise(async function p_emitEvent(resolve){
            try{

                //Set event as emitted
                _b.emitted[evt]=args;

                //Loop through all groups, calling all listener in them concurrently/asynchronously, then
                //wait for the group to finish before moving on to next group, OR timeout a group if opted
                var i,last=status.groups.slice(-1),argsRegexp,_args;
                for(i of status.groups){
                    var promises=groups[i].map(async function c_emitEvent(listener,j){
                        try{
                            status[i][j]='executing'
                            prog(evt,status,i,j)
                            //First check if this is a a one-time listener (do this before calling in case
                            //the callback emits the event again). NOTE: This will have no effect
                            if(listener.o === true)
                                self.removeListener(listener);

                            //For all listeners that don't have an 'exact match' string event, add
                            //the event to the args
                            if(typeof listener.e =='string')
                                _args=args;
                            else
                                _args=argsRegexp||(argsRegexp=[evt].concat(args));                            

                            //Then run the listener and add the result to the resolve-array
                            let res=await listener.l.apply(options.emitAs,_args);
                            status.results.push([true,res,i,j]);
                            

                            //Finally check if the result implies that we turn off the listener
                            if(res=='off')
                                self.removeListener(listener);

                        }catch(err){
                            // console.log(err);
                            _b.onerror('Listener failed.',{evt, listener, _args},err)
                            status.results.push([false,err,i,j]);
                        }
                        status[i][j]='finished'
                        prog(evt,status,i,j)
                        return; //Always return, never throw, since these promises are used to determine 
                                //when all listeners are done
                    })
                    
                    //...then wait for them all to finish OR add a timeout
                    var groupedPromises=Promise.all(promises);
                    if(_b.options.groupTimeout && i!=last){ //last group cannot timeout
                        try{
                            let timeout=new Promise((nada,expireGroup)=>{setTimeout(expireGroup,_b.options.groupTimeout)})
                            await Promise.all([groupedPromises,timeout])
                        }catch(err){
                            _b.onerror(`Group ${i} timed out, triggering next group...`);
                        }
                    }else{
                        await groupedPromises;
                    }
                }
            
            }catch(err){
                console.error('BUGBUG BetterEvents.emitEvent():',err);
            }
            return resolve(status.results); //resolves the 'allDone' promise with the 'results'
        });

        if(options.simple){
            return allDone;
        }else{
            Object.defineProperty(status,'promise',{value:allDone}); //so it doesn't get counted by getter, @see getStatusObj()
            return status;
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
    * @return Promise(void,n/a)     //TODO 2020-02-25: resolve with array just like emit()
    */
    BetterEvents.prototype.emitEvents=function(regexp,args,options){
        
        if(!regexp instanceof RegExp)
            throw new TypeError(errString(1,'r_evt',evt));
       
        var self=this;
        return new Promise(function _emitEvents(resolve){

            var events=self.getEvents(regexp);

            var promises=events.map(evt=>self.emitEvent(evt,args,options).promise);

            Promise.all(promises).then(()=>resolve());

        }).catch(err=>{
            self._betterEvents.onerror('BUGBUG BetterEvents.emitEvents():',err);
        })

    }



    /*
    * Calls emitEvent or emitEvents with multiple args concated into an array
    *
    * @throw TypeError
    * @return Promise(array|void)    Resolves when all listeners are done. If a string $evt was used it resolves 
    *                                  with an array of arrays, each child containing: 
    *                                   [(bool)success,(any)returned value ,(number) group id, (number) within-group id]
    *                                  else it resolves with void
    */
    BetterEvents.prototype.emit=function emit(evt,...args){
// if(evt=='shutdown'){console.log('emit called',args)}
        if(evt instanceof RegExp)
            return this.emitEvents(evt,args);
        else if(typeof evt=='string')
            return this.emitEvent(evt,args).promise;
        else
            throw new TypeError(errString(1,'evt',evt));
        
    }

    /*
    * Emit an event once, not doing anything if it's already been emitted
    * @throw TypeError
    * @return Promise(array|void)   Resolves right away with void (if previously emitted), or when emit() resolves
    */
    BetterEvents.prototype.emitOnce=function emitOnce(...args){
        if(!this.alreadyEmitted(args[0])){
            return this.emit.apply(this,args);
        }else{
            return Promise.resolve();
        }
    }




    /*
    * Add an event to a buffer and call emit() after a delay. If the same event is buffered
    * again within that delay the newer args are emitted instead. 
    *
    * @throw TypeError
    * @return void
    */
    BetterEvents.prototype.bufferEvent=function bufferEvent(evt,...args){
        if(typeof evt !='string')
            throw new TypeError(errString(1,'s_evt',evt));

        var _b=this._betterEvents

        _b.buffer[evt]=args;

        //Check if we've already triggered the timeout
        if(!_b.delayTimeout){

            var triggered = Date.now();
        
            _b.delayTimeout=setTimeout(()=>{
                //Log...
                var actualDelay=Date.now()-triggered;
                if((actualDelay-_b.options.bufferDelay)>Math.min(_b.options.bufferDelay*0.1,100))
                    console.warn("WARNING: Delayed event slow. Expected "+_b.options.bufferDelay+" ms, actual "
                        +actualDelay+" ms");

                //Empty buffer and reset flag so it can be triggered again
                var buffer=_b.buffer;
                _b.buffer={};
                _b.delayTimeout = null;

                //Emit each event individually...
                for(let evt in buffer){
                    this.emitEvent(evt,buffer[evt]);
                }

                //...then emit the buffer as a whole
                this.emit('_buffer',buffer);

            }, _b.options.bufferDelay)
        }

        return ;    
    }






//TODO 2020-03-19: is 'this' the same as 'global' in nodejs?

}(typeof window !== 'undefined' ? window : this || {}));
//simpleSourceMap=
//simpleSourceMap2=