import {combineReducers, Reducer} from "redux";
import {isArray, isObject} from "util";
import {
    ActionCreator,
    ActionWatcher,
    HandlerCreatorCombo,
    makeActions,
    parseActions,
    PayloadCreator,
    WatcherCreator,
} from "./actions";
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
    selectors: Hashmap<AnySelector>;
}

export type LogicFactory = (name: string) => Logic;
export interface Logic {
    readonly name: string;
    readonly actions: Hashmap<string>;
    readonly watchers: ActionWatcher[];
    readonly reducer: Reducer;
    readonly logics: Hashmap<SubLogic>;
}

export interface LogicParsingResult {
    actionTypes: string[];
    selectorCreators: Hashmap<SelectorCreator>;
    actionCreators: Hashmap<ActionCreator>;
    watcherCreators: WatcherCreator[];
    reducer: Reducer;
    logics: Hashmap<SubLogic>;
}

export function createLogic(descriptor: LogicDescriptor|((o: any) => LogicDescriptor), options: Hashmap<any> = {}) {
    let logic: Logic;
    return (name: string) => {
        if (logic && logic.name === name) { return logic; }
        descriptor = (typeof descriptor === "function") ? descriptor(options) : descriptor;
        const {reducer, ...result} = parseLogicDescriptor(descriptor, name);
        const logics = result.logics;
        logics[name] = {
            actionCreators: result.actionCreators,
            selectors: makeSelectors(result.selectorCreators),
        };
        const actions = result.actionTypes.reduce((o: any, type: string) => { o[type] = type; return o; }, {});
        const watchers = result.watcherCreators.map((wc: WatcherCreator) => wc(actions));
        logic = { name, actions, watchers, reducer, logics };
        return logic;
    };
}

function parseLogicDescriptor(logic: LogicDescriptor, rootPath: string = "logic"): LogicParsingResult {
    if (rootPath === "") { throw new Error("rootPath cannot be empty"); }
    const result: any = {}; // TODO define result type
    const logicName = rootPath.split(".").pop() as string;
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
    // parse "actions entry"
    const actionCreators: Hashmap<ActionCreator> = {};
    const watcherCreators: WatcherCreator[] = [];
    const reducers: Hashmap<any> = {};
    if (logic.actions || logicBase.actions) {
        const actions = Object.assign({}, logicBase.actions, logic.actions);
        const res = parseActions(actions, rootPath);
        Object.assign(actionCreators, res.actionCreators);
        watcherCreators.push(...res.watcherCreators);
        res.actionTypes.forEach((type: string) => {
            if (!actionTypes.includes(type)) { actionTypes.push(type); }
        });
        if (Object.keys(res.reducerHandlers).length > 0) {
            result.reducer = makeReducer(res.reducerHandlers, initialState);
        }
    }
    // parse sub logics
    const logics: Hashmap<any> = {};
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
            const subRootPath = rootPath + "." + subName;
            const subResult = parseLogicDescriptor(logic[key], subRootPath);
            subResult.actionTypes.forEach((type: string) => {
                if (!actionTypes.includes(type)) { actionTypes.push(type); }
            });
            watcherCreators.push(...subResult.watcherCreators);
            if (subResult.reducer) {
                reducers[subName] = subResult.reducer;
            }
            const subLogics = {
                [subRootPath]: {
                    actionCreators: subResult.actionCreators,
                    selectors: makeSelectors(subResult.selectorCreators),
                },
                ...subResult.logics,
            };
            Object.assign(logics, subLogics);
            // add selector for sublogic in current logic FIXME
            Object.keys(subLogics).forEach((logicPath: string) => {
                const subSelectorCreators = subResult.selectorCreators;
                Object.keys(subSelectorCreators).forEach((subPath) => {
                    const subSelectorCreator = subSelectorCreators[subPath];
                    const p = key + "." + subPath;
                    selectorCreators[p] = subSelectorCreator;
                });
            });
        } else {
            // defining a sub-state;
            const subName = key.substr(1);
            const subLogic = logic[key];
            const logicPath = rootPath + "." + subName;
            const subResult = parseLogicDescriptor(subLogic, logicPath);
            subResult.actionTypes.forEach((type: string) => {
                if (!actionTypes.includes(type)) { actionTypes.push(type); }
            });
            Object.keys(subResult.actionCreators).forEach((subPath) => {
                const actionCreator = subResult.actionCreators[subPath];
                actionCreators[subName + "." + subPath] = actionCreator;
            });
            const subSelectorCreators = subResult.selectorCreators;
            const subState = subLogic.state || subLogic.logic && subLogic.logic.state;
            const prvt = subLogic.private || subLogic.logic && subLogic.logic.private;
            if (subState && !prvt && Object.keys(subSelectorCreators).length === 0) {
                selectorCreators[subName] = makeSelectorCreator("@state", rootPath + "." + subName);
            } else {
                Object.keys(subSelectorCreators).forEach((subPath) => {
                    const selectorCreator = subSelectorCreators[subPath];
                    selectorCreators[subName + "." + subPath] = selectorCreator;
                });
            }
            watcherCreators.push(...subResult.watcherCreators);
            if (subResult.reducer) { reducers[subName] = subResult.reducer; }
        }
    });

    if (Object.keys(reducers).length > 0) {
        result.reducer =  combineReducers(reducers);
    }
    result.actionTypes = actionTypes;
    result.actionCreators = actionCreators;
    result.selectorCreators = selectorCreators;
    result.watcherCreators = watcherCreators;
    result.logics = logics;
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
    const propsAndActions: any = Object.keys(logic.logics).reduce((o: Hashmap<any>, path: string) => {
        const currentLogic: SubLogic = logic.logics[path];
        o[path] = {
            actions: makeActions(currentLogic.actionCreators, store.dispatch, logic.actions),
            mapStateToProps: (s: any) => makePropsFromSelectors(currentLogic.selectors, s),
        };
        return o;
    }, {});
    return (props: Hashmap<any> = {}) => {
        const newProps: Hashmap<any> = {...props};
        const state = store.getState();
        Object.keys(propsAndActions).forEach((path: string) => {
            const {actions, mapStateToProps} = propsAndActions[path];
            const pathArray = path.split(".").slice(1);
            const len = pathArray.length;
            if (len === 0) {
                Object.assign(newProps, {...mapStateToProps(state), actions});
            } else {
                let pointer = newProps;
                for (let i = 0; i < len; i++) {
                    const part = pathArray[i];
                    if (i === len - 1 || len === 0) {
                        pointer[part] = {...mapStateToProps(state), actions};
                    } else {
                        pointer[part] = pointer[part] || {};
                        pointer = pointer[part];
                    }
                }
            }
        });
        return newProps;
    };
}
