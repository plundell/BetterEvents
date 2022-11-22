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
    var firstLine=new Error("First line marker")

    //Make <Listener> class available on exported constructor function
    BetterEvents.Listener=Listener; 

    //Export from module if available
    if(typeof module === 'object' && module.exports){
        module.exports = BetterEvents;
    }

    //Set on window if available
    if(typeof window === 'object'){
        window.BetterEvents=BetterEvents;
    }

    if(typeof process=='object' && typeof process.env=='object' && typeof process.env.NODE_ENV=='string'){
        var development=process.env.NODE_ENV=='development';
    }
    










   
    /*
    * Verbose logger that respects possible devmode
    */
    function logdebug(...args){
        if(development){
            ((this?(this.log||this._log):undefined)||console).debug(...args)
        }
    }
    function logwarn(...args){
        ((this?(this.log||this._log):undefined)||console).warn(...args)
    }
    /*
    * Error logger
    */
    function logerror(...args){
        if(this){
            let log=this.log||this._log
            if(log && typeof log.error=='function'){
                log.error(...args);
                return;
            }
            if(this._betterEvents){
                console.warn("No log set on event emitter created @",this._betterEvents.createdAt);
            }else{
                console.warn("BetterEvents error handler called with this set to:",this);
            }
        }
        console.error(...args);
    }

    function replaceStack(targetErr,stackSrc){
        targetErr.stack=targetErr.toString()+stackSrc.stack.replace(stackSrc.toString,'')
        return targetErr;
    }

    /**
     * Default options. Used by parseOptions() when creating a new EventEmitter and when emitting an event (with one-time options)
     * 
     * NOTE: additional checks are done for these and other options in parseOptions()
     */
    BetterEvents.defaultOptions={
        groupTimeout:0 
        ,groupDelay:0 //the amount of time to wait before executing the next group (which can allow things to propogate if need be)
        ,defaultIndex:0
        ,onProgress:()=>{}
        ,runAs:'this'       //Available: this, global, empty=>an empty object,shared=>a shared new object, status=>the object returned by emitEvent
        ,duplicate:false   //true=>allow the same listener to be added multiple times. default false
        ,returnStatus:true //Default true => emitEvent() will return an object (@see _getStatusObj()), else a promise
    }
    const defaultOptionTypes={
        'groupTimeout':'number'
        ,'groupDelay':'number'
        ,'onProgress':'function'
        ,'listeners':'object'
        ,'returnStatus':'boolean'
        ,'onerror':'function'
    }






    function BetterEvents(options={}){


        //Make sure we've been new'ed
        if(!this instanceof BetterEvents || typeof this.removeAllListeners !='function'){
            console.error("EINVALID. 'this' in BetterEvents constructor:",this);
            console.error("EINVALID. 'this.removeAllListeners' in BetterEvents constructor:",this.removeAllListeners);
            throw new Error("BetterEvents() should be new'ed or called as object which inherits from BetterEvents. "
                +"See last console.error.");
        }

        if(globalObj.BetterLog){
            firstLine=globalObj.BetterLog.prepareInFileMarker(firstLine);
            lastLine=globalObj.BetterLog.prepareInFileMarker(lastLine);
        }
        Object.defineProperty(this,'_betterEvents',{value:{
            emitted:{}
            ,after:{}
            ,bufferEvt:{}
            ,buffer:[]
            ,intercept:{}
            ,options:parseOptions(options)
            ,running:{}
            ,createdAt:(new Error('a')).stack.split('\n').slice(2)[0].trim().replace(/^at\s+/,"")
        }});

        //Set a possible error handler directly on this (but non-enum)
        let errorHandler=this._betterEvents.options.onerror ?? logerror
        Object.defineProperty(this._betterEvents,'onerror',{configurable:true,value:(...args)=>{
            try{
                errorHandler.call(this,...args);
            }catch(e){
                console.error('BUGBUG. Bad error handler in BetterEvents instance.',err);
            }
        }})
        
        
        this.removeAllListeners(); //resets/sets default values of additional properties on this._betterEvents
    }

  


    /*
    * Removes all listeners for all events (ie. reset this emitter)
    * @return this
    */
    BetterEvents.prototype.removeAllListeners = function(evt=undefined){
        //Make compatible with node events
        if(evt){
            this.removeEvent(evt);
        }else{
            this._betterEvents.events={};
            this._betterEvents.regexp=[];
                //^Just like events^, one regexp can have multiple listeners, but regexps are objects so can't
                // be keys, and we don't want to use a Map since we want to compare their toString()s, so we
                // will store them on array as [[regex1,func1],[regex2,func2],...]
            // this._betterEvents.onAll=[];            //2020-10-12: just using regexp now
            this._betterEvents.onUnhandled=null;
        }

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


    /*
    * Parse options passed to a new instance, only keeping those we expected and only throwing if those are
    * the wrong type
    *
    * NOTE: used for both 
    *
    * @param object dirty   dirty options
    * @opt object onetime   one time options
    *
    * @throws TypeError
    *
    * @return object        Object of parsed options
    */
    function parseOptions(dirty,onetime){
        dirty=Object.assign({},dirty,onetime);
        var parsed=Object.assign({},BetterEvents.defaultOptions);
    
        
        for(let key in defaultOptionTypes){
            if(dirty.hasOwnProperty(key)){
                if(typeof dirty[key]==defaultOptionTypes[key] && dirty[key]!=null)
                    parsed[key]=dirty[key];
                else
                    throw new TypeError(`Option '${key}' should be a ${defaultOptionTypes[key]}, got: ${typeString(dirty[key])}`)
            }
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

        if(dirty.duplicate || dirty.duplicates){
            parsed.duplicates=true;
        }

        if(parsed.listeners){
            if(!parsed.listeners._createdByGetListenersForEmit){
                throw new Error("Option 'listeners' should be the object returned from getListenersForEmit(), got:"
                    +JSON.stringify(parsed.listeners));
            }
        }
        
        //Wrap progress function so it can't throw
        if(dirty.onProgress)
            parsed.onProgress=function onProgress(){try{dirty.onProgress.apply(this,arguments)}catch(err){logwarn.call(this,err)}};

        return parsed;
    }





    /**
    * Add a listener to an event. 
    * 
    * @params ...any args        @see Listener() parsing of args
    *
    * NOTE 1: Duplicate callbacks for the same event CAN be added, but .emitEvent() will only 
    *         call the first occurence of each callback unless option.duplicate is truthy
    * 
    * NOTE 2: Callbacks that return promises that never resolve can prevent other listeners 
    *         for the same event from running
    *
    * @throw TypeError
    * @return <Listener>        
    */
    BetterEvents.prototype.addListener=function(...args) {
        //Create the <Listener>
        var listener=new Listener(args,this);

        //Add it to the appropriate place        
        if(typeof listener.evt=='string'){
            (this._betterEvents.events[listener.evt]||(this._betterEvents.events[listener.evt]=[])).push(listener);
        }else{
           this._betterEvents.regexp.push(listener);
        }

        return listener;
    };





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
    function Listener(args, emitter){
        //Get the hidden prop from the parent emitter
        const _b=emitter._betterEvents

        
        var stack=(args.find(arg=>args instanceof Error)||new Error('Registered from')).stack;
        if(globalObj.BetterLog){
            stack=globalObj.BetterLog.discardLinesBetweenMarkers(stack,firstLine,lastLine);
        }else{
            let str="at BetterEvents.";
            stack=stack.split("\n").slice(2).map(line=>line.trim()).filter(line=>line&&!line.startsWith(str));
        }

        

        Object.defineProperties(this,{
            //For legacy we keep the single character props as getters
            i:{get:()=>this.index,set:(val)=>this.index=val}
            ,o:{get:()=>this.once,set:(val)=>this.once=val}
            ,l:{get:()=>this.callback,set:(val)=>this.callback=val}
            ,e:{get:()=>this.evt,set:(val)=>this.evt=val}
            ,n:{get:()=>this.runs,set:(val)=>this.runs=val}
            
            //Some synomyms for ease and clarity
            ,listener:{get:()=>this.callback,set:(val)=>this.callback=val}
            ,event:{get:()=>this.evt,set:(val)=>this.evt=val}
            ,group:{get:()=>this.index}

            ,emitter:{writable:true, value:emitter}
            ,createdAt:{value:stack[0]}
        })


        this.index=_b.options.defaultIndex
        this.once=false;
        this.runs=0;

        

        //First just assign without checking....
        if(args.length==1 && args[0] && typeof args[0]=='object'){
            //A single object with named props can be passed in...
            Object.assign(this,args[0])

        }else{ 

            //Allow args in any order
            args.forEach((arg,i)=>{switch(typeof arg){
                case 'function':this.callback=arg; break; //listener
                case 'boolean':this.once=arg; break; //once
                case 'number':this.index=arg; break; //index to run
                case 'string': 
                    if(arg.match(/^\++$/)&&this.index==_b.options.defaultIndex){ //first match => change index, second match =>fall through to this.evt='+'
                        this.index=_b.options.defaultIndex+arg.length; //increment index up
                    }else if(arg.match(/^\-+$/)&&this.index==_b.options.defaultIndex){ //first match => change index, second match =>fall through to this.evt='-'
                        this.index=_b.options.defaultIndex-arg.length; //increment index down
                    }else if(arg=='once' && this.once==false){
                        this.once=true;
                    }else if(!this.evt){
                        this.evt=arg; //event name
                    }else{
                        throw new Error(`EINVAL. Too many string args passed. Failed on arg #${i} of: ${JSON.stringify(args)}`);
                    }
                    break;
                case 'object':
                    if(arg instanceof RegExp)
                        this.evt=arg
                    else
                        throw new Error(`EINVAL. Unexpected object arg #${i}. Only event <RegExp> or single object matching return of this method allowed: `
                            +JSON.stringify(this));
            }})
        }

        //Then check...
        if(typeof this.callback!='function')
            throw new TypeError("No listener function passed, got: "+JSON.stringify(this));
        if(typeof this.evt!='string' &&  !(this.evt instanceof RegExp))
            throw new TypeError("No event string or RegExp was passed, got: "+JSON.stringify(this));

        //Finally, add a method that can always be used to remove this listener from this object...
        this.remove=()=>{
            try{
                emitter.removeListener(this.callback,this.evt);
                return true;
            }catch(e){
                return false; //the listener had previously been removed
            }
        }

        //...and one that can be used to add a timeout that fires if the event hasn't fired within that timespan
        this.timeout=(callback,timeout,cancelOnTimeout)=>{
            let n0=this.runs; //run times when timeout is registered...
            return setTimeout(()=>{
                //...compared to run times on timeout
                if(this.runs==n0){
                    if(cancelOnTimeout)
                        this.remove();
                    callback.call(emitter);
                }
            },timeout);
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
        this.execute=function(callAs,args,evt){
            //Make sure that the callback runs async (allowing any sync calls after it to run first)
            return new Promise((resolve,reject)=>{
                setTimeout((function executeEventCallback(){
                    try{ 
                        //Increment counter
                        this.runs++;

                        //Remove from emitter BEFORE since the callback may emit the event again
                        if(this.once)
                            this.remove();

                        //If our .evt is a RegExp, and a specific event is used to apply (ie. the regular behaviour of emitEvent()),
                        //prepend that event to the args
                        if(typeof this.evt!='string' && typeof evt=='string')
                            args=[evt].concat(args);                     

                        //Now run the callback which may return a value or a promise...
                        var result=this.callback.apply(callAs,args);

                        //The return value may be reason to remove it...
                        if(result=='off')
                            this.remove();
                        else if(typeof result=='object' && typeof result.then=='function')
                            result=result.then(res=>{if(res=='off'){this.remove()}return res;});
                             //^DevNote: the 'off' is meant for here, but we pass it on anyway for potential logging purposes

                        //Finally we return what may be a promise or may be a value
                        return resolve(result);

                    }catch(err){
                        reject(err);
                    }
                }).bind(this),0)
            })
        }


        /*
        * @param string emittedEvt
        * @return Promise(void,n/a);
        */
        this.executeAfter=(emittedEvt)=>{
            //Get possible pending promise for a currently running event
            let running=emitter._betterEvents.running[emittedEvt];
            if(running)
                running=running.slice(-1);

            let args;
            let listenerEventFailed=new Error(`Listener executed after ${emittedEvt} failed.`);
            
            return Promise.resolve(running)
                .then(()=>{
                    //get the args the emitted last
                    args=emitter._betterEvents.emitted[emittedEvt];

                    this.execute(_getEmitAs.call(emitter),args,emittedEvt);
                })
                .catch((err)=>{
                    emitter._betterEvents.onerror(listenerEventFailed,{listener:this,args:makeArgs(args)},err);
                })
            ;
        }


    }

    Listener.prototype.toString=function(){
        let created=this.createdAt.split("\n")[0].trim().replace(/^at\s+/,'');
        return `<Listener event:${this.evt} registered:${created}>`;
    }






    // palun 2022-11-22: probably don't include this so we mark that we're different than eg. html elements
    // /**
    // * @alias   addEventListener => addListener
    // */
    // BetterEvents.prototype.addEventListener=BetterEvents.prototype.addListener


    /**
    * Alias for addListener, but without possibility of additional args
    * 
    * @param string evt
    * @param function listener
    * 
    * @return <Listener>       
    */
    BetterEvents.prototype.on=function(evt,listener){
        return this.addListener(evt,listener);
    }


    /**
    * Add a listener which is only run once
    * 
    * @param string evt
    * @param function listener
    * 
    * @return <Listener>      
    */
    BetterEvents.prototype.once=function(evt,listener){
        return this.addListener(evt,listener,true); //true=>once
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
    // BetterEvents.prototype.onAll=function(listener,index=undefined){
    //     if(typeof listener!='function')
    //         throw new TypeError(errString(1,'listener',listener));

    //     var _b=this._betterEvents, obj=_b.onAll.find(obj=>obj.l==listener);
    //     if(obj){
    //         //If it already exists, just change the number if another is given here
    //         if(typeof index=='number')
    //             obj.i=index;
    //     }else{
    //         //NOTE: this object has no 'e' prop, which means that emitEvent() will call it
    //         //with the evt string as first arg and it will be ignored by removeEvent()

    //         _b.onAll.push({l:listener,i:(typeof index=='number' ? index : _b.options.defaultIndex)});
    //     }

    //     return;

    // }

    /*
    * Add a listener for all events        //2020-10-12: just using regexp now
    *
    * @return <Listener>
    */
    BetterEvents.prototype.onAll=function(){
        return this.addListener(/.+/,...Array.from(arguments));
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
    BetterEvents.prototype.after=function after(){
        //Add a listener so we get same handling 
        var listener=this.addListener.apply(this,arguments);

        //Now check if it's already been emitted, in which case we apply the listener with those arguments now
        var emittedEvt=this.alreadyEmitted(listener.evt);
        if(emittedEvt){
            //Apply the listener with the args of the emitted event (this returns a promise that always resolves
            //that we don't wait for)
            listener.executeAfter(emittedEvt);

            //If we were only supposed to run once, then the listener has no future use so return undefined
            if(listener.once)
                return;
        }
        
        //This implies that the listener may run again so return it
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
    BetterEvents.prototype.afterPromise=function afterPromise(evt,index){
        return new Promise((resolve,reject)=>{
            try{
                this.after(evt,(...args)=>resolve(args),'once',index);
            }catch(err){
                reject(err);
            }
        })
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
    BetterEvents.prototype.createCompoundEvent=function createCompoundEvent(cEvt, events){
        if(typeof cEvt!='string')
            throw new TypeError(errString(1,'s_evt',evt));
        if(!events instanceof Array || !events.length)
            throw new TypeError(errString(2,'an array of events',events));

        //Register listeners after each event we're listening for which stores the emitted data and counts down 
        //until all have been emitted, at which time our event is emitted
        //2019-11-25 DEAR FUTURE ME: don't define the function seperately since we need the 'evt' which
        //                      comes from the forEach()
        var cancelled=false
            ,compound={fired:{},remaining:events.slice(0),cancel:()=>cancelled=true}
            ,listenerEventFailed=new Error(`A listener for compound event '${cEvt}' failed.`)
            ,self=this
        ;
        events.forEach(evt=>this.after(evt,'once',function executeCompoundEvent(...args){
            try{
                if(cancelled)
                    return;

                //Store the args of this event
                compound.fired[evt]=args;

                //As ^ growns, remaining shrinks...
                compound.remaining.splice(compound.remaining.indexOf(evt),1);

                //When no more events remain...
                if(!compound.remaining.length){
                    //...if it has, that means all events have fired and we can now call the passed in listener
                    logdebug.call(self,`Running compound event '${cEvt}' now with:`,compound.fired)
                    self.emitEvent(cEvt,[compound.fired],undefined,listenerEventFailed);
                }else{
                    logdebug.call(self,`'${evt}' just ran, but compound event '${cEvt}' is still waiting on: ${compound.remaining.sort()}`)
                }
            }catch(err){
                logwarn.call(self,`Compound event '${cEvt}' will not run.`,err)
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
    BetterEvents.prototype.afterAll=function(events,callback,timeout,cancelOnTimeout){
        if(!events instanceof Array||!events.length)
            throw new TypeError(errString(1,'an array of events',events));
        if(typeof callback!='function')
            throw new TypeError(errString(2,'a callback function',callback));

        
        //Copy to break links from passed in array (so we can always run)
        events=events.slice(0);

        //Check if an compound event for these events has already been created, else do so now
        var cEvt='compoundEvent_'+events.map(evt=>evt.toString()).sort().join('|');
        if(this.getListeners(cEvt,true).length==0)
            var compound=this.createCompoundEvent(cEvt,events); 


        //Now register the callback
        var listener=this.addListener(cEvt,callback,'once');



        //Create getter which lists the remaining and fired events so we can always check what we're waiting for. If we just
        //created $compound ^ then use the props on it instead of building it here...
        Object.defineProperty(listener,'remaining',{
            enumberable:true
            ,get:()=>compound?compound.remaining.slice(0):events.filter(evt=>this.alreadyEmitted(evt)==undefined)
        });
        Object.defineProperty(listener,'fired',{
            enumberable:true
            ,get:()=>{
                if(compound)
                    return Object.assign({},compound.fired);
                var fired={};
                for(let evt of events){
                    evt=this.alreadyEmitted(evt); //check if it's been emitted (and if a regexp get the actuall evt name)
                    if(evt)
                        fired[evt]=this._betterEvents.emitted[evt];
                };
                return fired;
            }
        });

        //If a timeout is passed
        if(typeof timeout=='number'){
            listener.timeout(()=>{
                let logstr=(callback.name?`Callback ${callback.name}()`:'A callback')+` for ${cEvt}` 
                logstr+=(cancelOnTimeout ? ' is now cancelled (timed out)' : " hasn't run yet");
                let remaining=listener.remaining;
                if(!remaining.length){
                    logerror.call(this,`BUGBUG: ${logstr}, but all events have fired:`,listener.fired);
                }else{
                    logerror.call(this,`${logstr} because we are still waiting on ${remaining.length} events: `
                        +`'${remaining.join("','")}'.`);
                }
            },timeout,cancelOnTimeout);
        }

        return listener;
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
    BetterEvents.prototype.onFirst=function(){
        try{
            //Define an array or listeners and a method to remove them all
            var listeners=[], removeListeners=()=>{
                try{
                    var listener;
                    while(listener=listeners.pop()){
                        try{this.removeListener(listener)}catch(err){logerror.call(this,err,listener)}
                    }
                }catch(err){logerror.call(this,err)}
            };
            for(let args of arguments){
                //Create a listener and add it to our list
                let listener=this.addListener.apply(this,args)
                listeners.push(listener);

                //Wrap the callback in another function that removes all other listeners before running
                let cb=listener.callback;
                listener.callback=function(){
                    removeListeners();
                    return cb.apply(this,arguments);
                }
            }

            //Attach the remove-method to the returned array for ease...
            Object.defineProperty(listeners,'removeAll',{value:removeListeners});

            return listeners;

        }catch(err){
            //Anything goes wrong and we remove any listeners we had time to add, before re-throwing the error
            removeListeners();
            throw err; //rethrow
        }
    }


    /*
    * Works like a hybrid of after() and onFirst(), ie. a single callback runs *after* the first event
    *
    * @return array[<Listeners>...]|undefined     @see .onFirst() or .after()
    */
    BetterEvents.prototype.afterFirst=function(){
        //First add them all...
        var listeners=this.onFirst.apply(this,arguments);

        //...then check if any have already run
        for(let listener of listeners){
            let emittedEvt=this.alreadyEmitted(listener.evt);
            if(emittedEvt){
                listener.executeAfter(emittedEvt);

                //Just like with .after() we return undefined here since all the listeners have already been removed
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
    BetterEvents.prototype.getListeners=function(evt,getDuplicates=true){

        var listeners,events=this._betterEvents.events;
        if(typeof evt=='string'){
            //Get listeners for the exact event, eg. 'shutdown_network'
            listeners=events[evt] || [];

            //...+ get listeners that have been registered with a regex to match this event 
            //and more, eg. /shutdown_.*/
            this._betterEvents.regexp.forEach(listener=>{
                if(evt.match(listener.evt))
                    listeners.push(listener);
            })
        }else if(evt instanceof RegExp){
            var regex=evt;
            listeners=[];
            for(evt in events){
                if(evt.match(regex))
                    listeners=listeners.concat(events[evt]);
            }
        }else if(!arguments.length){
            throw new Error("getListeners() was called without arguments. It needs to be called with an event name or regexp.");
        }else{
            throw new TypeError(errString(1,'evt',evt));
        }

        //Either filter away duplicate callbacks or return all of them
        if(getDuplicates){
            return listeners
        }else{
            listeners.map(l=>l.l).forEach((c,i,arr)=>{if(arr.indexOf(c)!==i){delete listeners[i]}});
            return listeners.filter(l=>l);
        }
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
        // if(this._betterEvents.onAll.length || this._betterEvents.onUnhandled) //2020-10-12: just using regexp now
        if(this._betterEvents.onUnhandled)
            return true;

        //...then check for specific ones
        return this.getListeners(evt).length>0;
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
    BetterEvents.prototype.hasListener = function hasListener(evtOrListner,callback) {
        if(evtOrListner && evtOrListner.evt){
            var evt=evtOrListner.evt;
            callback=evtOrListner.listener;
        }else{
            evt=evtOrListner;
        }

        return this.getListeners(evt,true).find(listener=>listener.callback==callback) ? true : false;
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
    * @param <Listener>|function   listener   
    * @param string|<RegExp>       evt        Ignored if $listener is <Listener>
    *
    * @throws TypeError
    * @throws Error     If the listener doesn't exist
    *
    * @return <Listener>|undefined      The removed listener object, or undefined
    */
    BetterEvents.prototype.removeListener=function(listener,evt){

        if(listener instanceof Listener){
            evt=listener.evt;
            listener=listener.listener;
        }else if(typeof listener!='function'){
            throw new TypeError(errString(1,'listener',listener));
        }

        //Now get the applicable list of events or regexes <Listeners>
        if(typeof evt=='string')
            var events=this._betterEvents.events[evt]||[];
        else if(evt instanceof RegExp)
            events=this._betterEvents.regexp;
        else
            throw new TypeError(errString(2,'evt',evt));

        //Now match $listner and $evt
        let i=events.findIndex(obj=>obj.listener==listener && String(obj.evt)==String(evt));
        if(i>-1)
            return events.splice(i,1)[0];
        

        //Finally, check the unhandled section...
        if(this._betterEvents.onUnhandled && this._betterEvents.onUnhandled.listener==listener){
            listener=this._betterEvents.onUnhandled;
            this._betterEvents.onUnhandled=null;
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
    BetterEvents.prototype.removeListeners=function(listener){
        if(typeof listener !='function')
            throw new TypeError(errString(1,'listener',listener));

        var removed=[];
        var remove=function(events){
            for(let i=events.length-1;i>-1;i--){
                if(events[i].listener==listener)
                    removed.push(events.splice(i,1));
            }
        }

        //Loop through all events and remove every <Listener> with .listener==$listener
        Object.values(this._betterEvents.events).forEach(remove);

        //Check regexp...
        remove(this._betterEvents.regexp);

        //Check unhandled
        if(this._betterEvents.onUnhandled.listener==listener){
            removed.push(this._betterEvents.onUnhandled);
            this._betterEvents.onUnhandled=null;
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





    /*
    * Register a function to intercept events being emitted. This can either prevent event altogether or
    * change the args being passed to the listners
    *
    * @param string evt
    * @param function interceptor   Will be called as this
    */
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
    * @return object      Keys are indexes, values are arrays listener objects.
    *                                       { "-1":[{l,i:-1}]
    *                                           ,0:[{l,o,e}]        
    *                                           ,1:[{l,o,i,e},{l,o,i,e},...] 
    *                                            ,...
    *                                       }
    * @call(this)
    * @private
    */
    BetterEvents.prototype.getListenersForEmit=function(evt,exclude){

        var listeners=this.getListeners(evt,this._betterEvents.options.duplicate)

        //If no listeners were found, this is an 'unhandled' event, which merits the onUnhandled listener
        if(!listeners.length && this._betterEvents.onUnhandled ){
            // logdebug.call(this,'Adding onUnhandled')
            listeners.push(this._betterEvents.onUnhandled)
        }
        // else{logdebug.call(this,'NOT adding onUnhandled to:',listeners)}

    //2020-10-12: just using regexp now
        //If onAll has been specified, always add it (will end up first in its group, but unless the group
        //is otherwise empty it will run concurrently with other listeners)
        // if(this._betterEvents.onAll.length){                                   
        //     // logdebug.call(this,'Adding onAll')
        //     listeners=[].concat(this._betterEvents.onAll,listeners)
        // }

         //Remove any we want to exclude (parseOptions should have made sure it's an array)
        if(exclude){
            exclude.forEach(listener=>{
                let i=listeners.findIndex(({l})=>l==listener)
                if(i>-1)
                    listeners.splice(i,1);
            })
        }

        //Group listeners based on their index
        var groupedListeners={};
        listeners.forEach(listener=>{
            let group=(listener.hasOwnProperty('i')?listener['i']:0);
            (groupedListeners[group]=groupedListeners[group]||[]).push(listener)
        })

        //And finally, to be used by parseOptions, a secret flag
        Object.defineProperty(groupedListeners,'_createdByGetListenersForEmit',{value:true});

        return groupedListeners;
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
    function _getStatusObj(groupedListeners,returnStatus){
        var status={};
        Object.defineProperties(status,{
            'results':{value:[]}  //results in whichever order they finish, child arrays are [true/false, result, i, j]
            ,'groups':{value:Object.keys(groupedListeners).sort()}// <<---------------------------------- this is what decides group order
            ,'intercepted':{value:false, writable:true}
            ,'promise':{writable:true, value:undefined, enumerable:false} 
              //^changed to an actual promise by emitEvent() to return o.results. defined here as non-enum so getters vv don't count it
        });

        Object.defineProperty(status.results,'get',{value:function getResult(g,j){return status.results.find(result=>result[2]==g && result[3]==j)}});

        var l=0
        for(let g of status.groups){  //this is the ordered keys
            let group=status[g]={};             //these are the only enumerable props on the status object...
            for(let j in groupedListeners[g]){
                group[j]='waiting';             //...and these the only enumerable on ^
                l++;
            }

            //If opted add getters that get states in the group
            if(returnStatus){ 
                Object.defineProperties(group,{
                    'length':{value:Object.keys(group).length}
                    ,'listeners':{value:groupedListeners[g]}
                    ,'waiting':{get:()=>Object.values(group).reduce((sum,state)=>sum+(state=='waiting'?1:0),0)}
                    ,'executing':{get:()=>Object.values(group).reduce((sum,state)=>sum+(state=='executing'?1:0),0)}
                    ,'finished':{get:()=>Object.values(group).reduce((sum,state)=>sum+(state=='finished'?1:0),0)}
                    ,'started':{get:()=>group.length>group.waiting}
                    ,'remaining':{get:()=>group.length-group.finished}
                    ,'progress':{get:()=>Math.round(group.finished/group.length*100)||0}
                    ,'done':{get:()=>group.progress==100}
                    ,'names':{value:Object.values(groupedListeners[g]).map(listener=>listener.callback.name||'anonymous')}
                    ,'statusEntries':{value:()=>group.names.map((name,j)=>[name,group[j],g,j])}
                     //^DevNote: We call it 'statusEntries' because it kind of works like Object.entries(group) except we're using the name instead of the key
                })
            }
        }
        Object.defineProperty(status,'length',{value:l});

        //If opted add getters that sum every group to give aggregates
        if(returnStatus){
            Object.defineProperties(status,{
                'listeners':{value:groupedListeners}
                ,'waiting':{get:()=>Object.values(status).reduce((sum,group)=>sum+group.waiting,0)}
                ,'executing':{get:()=>Object.values(status).reduce((sum,group)=>sum+group.executing,0)}
                ,'finished':{get:()=>status.results.length} //regarless of group, how many listeners have finished
                ,'progress':{get:()=>Math.round(status.finished/status.length*100)||0} //of total listeners, how many have finished, 0-100
                ,'done':{get:()=>status.progress==100}
                ,'names':{get:()=>status.groups.map(g=>status[g].names).flat()}
                ,'statusEntries':{value:()=>status.groups.map(g=>status[g].statusEntries()).flat()}

                ,'groupsStarted':{get:()=>Object.values(status).reduce((sum,group)=>sum+(group.started?1:0),0)}
                ,'groupsDone':{get:()=>Object.values(status).reduce((sum,group)=>sum+(group.done?1:0),0)}
                ,'groupsExecuting':{get:()=>status.length-status.groupsDone}
                ,'groupsWaiting':{get:()=>status.length-status.groupsStarted}
                
            })
        }
        return status;
    }

    /*
    * Get the object to call each callback with
    *
    * @opt object options
    * @return object
    */
    function _getEmitAs(options){
        options=options||this._betterEvents.options;
        switch(options.emitAs){
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
                if(typeof options.emitAs=='object'){
                    return options.emitAs;
                }else{
                    throw new Error("Bad option .emitAs: ("+typeof options.emitAs+")"+String(options.emitAs))
                }
        }
    }


    /*
    * Turn args into an arguments object
    * @param array|<arguments>|any
    * @return <arguments>
    */
    function makeArgs(args){
        if(args==undefined){
            args=[];
        }else if(typeof args=='object' && args){
            if(args.hasOwnProperty('callee') && args.hasOwnProperty('length') && Object.getOwnPropertySymbols(args).map(String)=='Symbol(Symbol.iterator)')
                return args;
            else if(!Array.isArray(args))
                args=[args];
        }else{
            args=[args];
        }
        return _makeArgs.apply(this,args);
    }
    function _makeArgs(){return arguments;}




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
    BetterEvents.prototype.emitEvent = function(evt, args=undefined, options=undefined,listenerEventFailed=undefined) {
        //Only allow string events. For emitting all events that match a regexp, use emitEvents()
        if(typeof evt!='string')
            throw new TypeError(errString(1,'s_evt',evt));

        options=parseOptions(this._betterEvents.options,options)
        var prog=options.onProgress //will always be a func, possibly an empty one
            ,groupedListeners=options.listeners||this.getListenersForEmit(evt,options.exclude)
            ,status=_getStatusObj(groupedListeners, options.returnStatus)
            ,emitAs=_getEmitAs.call(this, options) //won't matter if callback is bound
        ;

        //Make sure we have an arg array AND delink it from the passed in array (BUT IT DOES NOT delink the individual args)
        args=[].concat(args);
          //NoteToSelf 2020-11-11: Don't change this into an arguments object... 


        //Allow possibility to intercept an event...
        if(this._betterEvents.intercept.hasOwnProperty(evt)){
            args=this._betterEvents.intercept[evt].apply(this,args);
            
            //...and if it doesn't return an array of new args we classify the event as "intercepted" and we return early
            if(!Array.isArray(args)){
                status.intercepted=true;
                status.promise=Promise.resolve(status.results);
                prog(evt,status);
            }
        }


        if(!status.intercepted){

            //REMEMBER: everything in this block is async
            listenerEventFailed=listenerEventFailed ?? new Error(`A listener for event '${evt}' failed.`);
            var _b=this._betterEvents, self=this;
            status.promise=new Promise(async function emitEvent_runListenersAsync(resolve){
                try{

                    //Set event as emitted and running
                    _b.emitted[evt]=args;
                    if(!_b.running[evt])
                        _b.running[evt]=[];
                    _b.running[evt].push(status.promise) //is removed at bottom of this promise

                    var lastGroup=status.groups.slice(-1);

                    //Loop through all groups, calling all listener in them concurrently/asynchronously, then
                    //wait for the group to finish before moving on to next group, OR timeout a group if opted
                    for(let g of status.groups){

                        var promises=groupedListeners[g].map(async function emitEvent_forEachListener(listener,j){
                         //^DevNote: remember, since this function is async it will return a promise... ie. we're not actually
                         //          awaiting this listener before running the next listener in the same group

                            //Sanity check
                            if(!(listener instanceof Listener)){
                                let t=typeof listener;
                                let err=replaceStack(new Error(`BUGBUG: A ${t} (not an instance of BetterEvents.Listener) was registered `
                                    +`as a listener for '${evt}'`),listenerEventFailed);
                                console.error(err,listener);
                                status.results.push([false,err,g,j]);
                                //after this it jumps down and gets status finished...
                            }else{
                                try{
                                    //Mark and count as running...
                                    status[g][j]='executing';
                                    prog(evt,status,g,j);                      

                                    //Then run the listener and add the result to the resolve-array
                                    let res=await listener.execute(emitAs,args,evt);
                                    status.results.push([true,res,g,j]);
                                }catch(err){
                                    // logdebug.call(this,err);
                                    self._betterEvents.onerror(listenerEventFailed,{listener,args:makeArgs(args),options},err);
                                    status.results.push([false,err,g,j]);
                                }
                            }

                            status[g][j]='finished'
                            prog(evt,status,g,j)
                                
                            return; //Always return, never throw, since these promises are used to determine 
                                    //when all listeners are done
                        })

                        
                        //...then wait for them all to finish OR add a timeout
                        var groupedPromises=Promise.all(promises);
                        if(options.groupTimeout && g!=lastGroup){ //last group cannot timeout
                            try{
                                let timeout=new Promise((nada,expireGroup)=>{setTimeout(expireGroup,options.groupTimeout)})
                                await Promise.all([groupedPromises,timeout])
                            }catch(err){
                                self._betterEvents.onerror(replaceStack(
                                    new Error(`Group ${g} for event '${evt}' timed out, triggering next group...`)
                                    ,listenerEventFailed
                                ));
                            }
                        }else{
                            await groupedPromises;
                        }

                        //If we're delaying between groups...
                        if(options.groupDelay && status.groups.length>1 && g!=lastGroup)
                            await new Promise((wakeup)=>{setTimeout(wakeup,options.groupDelay)})
                    }
                
                }catch(err){
                    console.error('BUGBUG - BetterEvents.emitEvent() should have caught and handled all errors, but this got through:',err);
                }

                //Remove from running
                _b.running[evt].splice(_b.running[evt].indexOf(status.promise),1);

                return resolve(status.results);
            });
            //REMEMBER: ^everything in this block is async
        }


        //Finally (but before all of ^ runs) decide what to return
        if(options.returnStatus){
            return status;
        }else{
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
    BetterEvents.prototype.emitEvents=function(regexp,args,options){
        
        if(!regexp instanceof RegExp)
            throw new TypeError(errString(1,'r_evt',evt));
       
        var self=this,listenerEventFailed=new Error(`A listener matching regexp event '${regexp}' failed.`);
        return new Promise(function _emitEvents(resolve){

            var events=self.getEvents(regexp);

            var results={},promises=[];
            for(let evt of events){
                let obj=self.emitEvent(evt,args,options,listenerEventFailed);
                let promise=obj.promise||obj;//since we don't know if options.returnStatus==true
                promises.push(promise.then(result=>{results[evt]=result}));
            }

            Promise.all(promises).then(()=>resolve(results));

        }).catch(err=>{
            console.error('BUGBUG BetterEvents.emitEvents():',err);
        })

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
    BetterEvents.prototype.emit=function emit(evt,...args){
// if(evt=='shutdown'){logdebug.call(this,'emit called',args)}
        var options={returnStatus:false}; //we don't care about the status object having a bunch of getters since we just want the results
        if(evt instanceof RegExp)
            return this.emitEvents(evt,args,options);
        else if(typeof evt=='string')
            return this.emitEvent(evt,args,options); 
        else
            throw new TypeError(errString(1,'evt',evt));
        
    }

    /*
    * Emit an event once, not doing anything if it's already been emitted
    * @throw TypeError
    * @return Promise(array|void)   Resolves right away with void (if previously emitted), or when emit() resolves
    */
    BetterEvents.prototype.emitOnce=function emitOnce(evt,...args){
        if(!this.alreadyEmitted(evt)){
            return this.emit.call(this,evt,...args);
        }else{
            return Promise.resolve();
        }
    }




  



var lastLine=new Error("Last line marker")
}((typeof window !== 'undefined' ? window : (typeof global!='undefined' ? global : this)) || {}));
//simpleSourceMap=
//simpleSourceMap2=