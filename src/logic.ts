import {combineReducers, Reducer} from "redux";
import {isArray, isObject} from "util";
import {
    ActionCreator,
    ActionWatcher,
    HandlerCreatorCombo,
    makeActions,
    parseActions,
    parseHandlers,
    PayloadCreator,
    WatcherCreator,
} from "./actions";
import {isPlainObject, setPath} from "./helpers";
import {
    AnySelector,
    makePropsFromSelectors,
    makeSelectorCreator,
    makeSelectors,
    parseSelectors,
    SelectorCreator,
} from "./selectors";
import {LogicsStore} from "./store";
import {Hashmap} from "./types";

export interface LogicDescriptor {
    state?: any;
    private?: boolean;
    selectors?: {
        [selectorKey: string]: string|any[]|(() => any);
    };
    actions?: {
        [actionKey: string]: [string, PayloadCreator]|HandlerCreatorCombo|string;
    };
    actionTypes?: string[];
    [namespaceKey: string]: any;
}

export type LogicDescriptorFactory = (options: {[opt: string]: any}) => Logic;

interface SubLogic {
    actionCreators: Hashmap<ActionCreator>;
    // selectors: Hashmap<AnySelector>;
}

export type LogicFactory = (name: string) => Logic;
export interface Logic {
    readonly name: string;
    readonly actions: Hashmap<string>;
    readonly watchers: ActionWatcher[];
    readonly reducer: Reducer;
    readonly selectors: Hashmap<AnySelector>;
    readonly actionCreators: Hashmap<Hashmap<ActionCreator>>;
    // readonly logics: Hashmap<SubLogic>;
}

export interface LogicParsingResult {
    actionTypes: string[];
    selectorCreators: Hashmap<SelectorCreator>;
    actionCreators: Hashmap<Hashmap<ActionCreator>>;
    watcherCreators: WatcherCreator[];
    reducer: Reducer;
    // logics: Hashmap<SubLogic>;
}

export function createLogic(descriptor: LogicDescriptor|((o: any) => LogicDescriptor), options: Hashmap<any> = {}) {
    let logic: Logic;
    return (name: string) => {
        if (logic && logic.name === name) { return logic; }
        descriptor = (typeof descriptor === "function") ? descriptor(options) : descriptor;
        const {reducer, ...result} = parseLogicDescriptor(descriptor, name);
        const selectors = makeSelectors(result.selectorCreators);
        const actionCreators = result.actionCreators;
        const actionTypes = result.actionTypes.reduce((o: any, type: string) => { o[type] = type; return o; }, {});
        const actions = makeActions(actionCreators, actionTypes);
        const watchers = result.watcherCreators.map((wc: WatcherCreator) => wc(actions));
        logic = { name, actions, watchers, reducer, selectors, actionCreators };
        return logic;
    };
}

function parseLogicDescriptor(logic: LogicDescriptor, rootPath: string = "logic"): LogicParsingResult {
    if (rootPath === "") { throw new Error("rootPath cannot be empty"); }
    const result: any = {}; // TODO define result type
    // const logicName = rootPath.split(".").pop() as string;
    const logicBase: LogicDescriptor = logic.logic || {};
    // define initial state
    const initialState: any = logic.state || logicBase.state;
    // define action types
    const actionTypes: string[] = logicBase.actionTypes || [];
    (logic.actionTypes || []).forEach((type: string) => {
        if (!actionTypes.includes(type)) { actionTypes.push(type); }
    });
    // parse "selectors" entry
    const selectorCreators: Hashmap<SelectorCreator> = {};
    if (logic.selectors || logicBase.selectors) {
        const selectors = Object.assign({}, logicBase.selectors, logic.selectors);
        Object.assign(selectorCreators, parseSelectors(selectors, rootPath));
    }
    const reducers: Hashmap<any> = {};
    const actionCreators: Hashmap<Hashmap<ActionCreator>> = {};
    const watcherCreators: WatcherCreator[] = [];
    const reducerHandlers: Hashmap<Reducer> = {};
    // parse "actions entry"
    if (logic.actions || logicBase.actions) {
        const actions = Object.assign({}, logicBase.actions, logic.actions);
        const res = parseActions(actions, rootPath);
        Object.assign(actionCreators, {[rootPath]: res.actionCreators});
        Object.assign(reducerHandlers, res.reducerHandlers);
        watcherCreators.push(...res.watcherCreators);
        res.actionTypes.forEach((type: string) => {
            if (!actionTypes.includes(type)) { actionTypes.push(type); }
        });
        // if (Object.keys(res.reducerHandlers).length > 0) {
        //     result.reducer = makeReducer(res.reducerHandlers, initialState);
        // }
    }
    // parse "handlers entry"
    if (logic.handlers || logicBase.handlers) {
        const handlers = Object.assign({}, logicBase.handlers, logic.handlers);
        const res = parseHandlers(handlers, rootPath);
        Object.assign(reducerHandlers, res.reducerHandlers);
        watcherCreators.push(...res.watcherCreators);
        res.actionTypes.forEach((type: string) => {
            if (!actionTypes.includes(type)) { actionTypes.push(type); }
        });
    }
    if (Object.keys(reducerHandlers).length > 0) {
        result.reducer = makeReducer(reducerHandlers, initialState);
    }
    // parse sub logics
    Object.keys(logic).forEach((key: string) => {
        if (key[0] !== "_") { return; }
        if (isArray(logic[key]) || !isObject(logic[key])) {
            throw new Error("invalid logic: sub-logic must be a plain object");
        }
        if (initialState !== undefined) {
            throw new Error("invalid logic: cannot define a sub-logic inside a sub-state");
        }
        if (key.match("^__")) {
            // defining a sub-namespace;
            const subName = key.substr(2);
            const logicPath = rootPath + "." + subName;
            const subResult = parseLogicDescriptor(logic[key], logicPath);
            subResult.actionTypes.forEach((type: string) => {
                if (!actionTypes.includes(type)) { actionTypes.push(type); }
            });
            watcherCreators.push(...subResult.watcherCreators);
            if (subResult.reducer) { reducers[subName] = subResult.reducer; }
            // add selector for sublogic in current logic
            const subSelectorCreators = subResult.selectorCreators;
            Object.keys(subSelectorCreators).forEach((subPath) => {
                const subSelectorCreator = subSelectorCreators[subPath];
                const p = subName + "." + subPath;
                selectorCreators[p] = subSelectorCreator;
            });
            // put action creators is sub-namespace
            Object.assign(actionCreators, subResult.actionCreators);
    } else {
            // defining a sub-state;
            const subName = key.substr(1);
            const subLogic = logic[key];
            const logicPath = rootPath + "." + subName;
            const subResult = parseLogicDescriptor(subLogic, logicPath);
            subResult.actionTypes.forEach((type: string) => {
                if (!actionTypes.includes(type)) { actionTypes.push(type); }
            });
            watcherCreators.push(...subResult.watcherCreators);
            if (subResult.reducer) { reducers[subName] = subResult.reducer; }
            // add selector for sublogic in current logic
            const subSelectorCreators = subResult.selectorCreators;
            const subState = subLogic.state || subLogic.logic && subLogic.logic.state;
            const prvt = subLogic.private || subLogic.logic && subLogic.logic.private;
            if (subState && !prvt && Object.keys(subSelectorCreators).length === 0) {
                // make selector creator for the whole state if no selectors are defined
                selectorCreators[subName] = makeSelectorCreator("@state", rootPath + "." + subName);
            } else {
                Object.keys(subSelectorCreators).forEach((subPath) => {
                    const selectorCreator = subSelectorCreators[subPath];
                    selectorCreators[subName + "." + subPath] = selectorCreator;
                });
            }
            // merge action creators
            const subActionCreators = subResult.actionCreators[logicPath];
            Object.keys(subActionCreators).reduce((o: any, k: string) => {
                o[subName + "." + k] = subActionCreators[k];
                return o;
            }, actionCreators[rootPath]);
        }
    });
    if (Object.keys(reducers).length > 0) {
        result.reducer =  combineReducers(reducers);
    }
    result.actionTypes = actionTypes;
    result.actionCreators = actionCreators;
    result.selectorCreators = selectorCreators;
    result.watcherCreators = watcherCreators;
    return result as LogicParsingResult;
}

function makeReducer(handlers: Hashmap<any>, initialState: any) {
    if (initialState === undefined) {
        throw new Error("invalid logic: cannot define a reducer without an initial state");
    }
    return (state: any = initialState, action: any) => {
        const handle = handlers[action.type];
        if (!handle) { return state; }
        const payload = action.payload === undefined ? action : action.payload;
        return handle(state, payload, action.error);
    };
}

export function makeGetProps(logic: Logic, store: LogicsStore) {
    const logicActions: any = {};
    Object.keys(logic.actionCreators).forEach((logicPath: string) => {
        const actions = logic.actionCreators[logicPath];
        if (!actions) { return; }
        const actionTree = {};
        Object.keys(actions).forEach((actionPath) => {
            const dispatch = (...args: any[]) => store.dispatch(actions[actionPath](...args));
            return setPath(actionTree, "actions." + actionPath, dispatch);
        });
        const subPath = logicPath.split(".").slice(1);
        if (subPath.length === 0) {
            Object.assign(logicActions, actionTree);
        } else {
            setPath(logicActions, subPath, actionTree);
        }
    });
    return (props: Hashmap<any> = {}) => {
        const state = store.getState();
        const logicProps: Hashmap<any> = {...props, ...makePropsFromSelectors(logic.selectors, state)};
        return deepMerge(logicProps, logicActions);
    };
}

function deepMerge(o1: any, o2: any) {
    const o = {...o1};
    Object.keys(o2).forEach((k) => {
        const value = o2[k];
        if (isPlainObject(o2[k])) {
            o[k] = isPlainObject(o[k]) ? o[k] : {};
            o[k] = deepMerge(o[k], o2[k]);
        } else {
            o[k] = o2[k];
        }
    });
    return o;
}
