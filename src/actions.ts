import {AnyAction, Dispatch} from "redux";
import {ForkEffect, takeEvery, takeLatest} from "redux-saga/effects";
import {isArray, isFunction, isObject} from "util";
import {getPath, setPath} from "./helpers";
import {Hashmap} from "./types";

export function parseActions(actions: Hashmap<any>, rootPath: string) {
    const actionCreators: Hashmap<ActionCreator> = {};
    const reducerHandlers: Hashmap<ReducerHandler> = {};
    const watcherCreators: any[] = [];
    const actionTypes: string[] = [];
    Object.keys(actions).forEach((actionName) => {
        if (!actionName.match("^[a-zA-Z_]*$")) {
            throw new Error(`invalid logic: "${actionName}" is not a valid action name`);
        }
        if (isObject(actions[actionName]) && !isArray(actions[actionName])) {
            // defining combo (action creator + handler)
            const combo = actions[actionName] as HandlerCreatorCombo;
            // defining action creator
            const type: string = makeActionType(rootPath, actionName);
            const result = parseCombo(combo, type, actionName);
            if (result.actionCreator) {
                actionCreators[actionName] = result.actionCreator;
            }
            if (result.reducerHandler) {
                reducerHandlers[type] = result.reducerHandler;
            }
            if (result.watcherCreator) {
                watcherCreators.push(result.watcherCreator);
            }
            if (!actionTypes.includes(type)) { actionTypes.push(type); }
        } else if (isFunction(actions[actionName])) {
            // defining a handler for the reducer;
            const type = makeActionType(...rootPath.split("."), actionName);
            reducerHandlers[type] = actions[actionName] as ReducerHandler;
            if (!actionTypes.includes(type)) { actionTypes.push(type); }
        } else if (isArray(actions[actionName])) {
            // defining an action creator
            const [actionType, payloadCreator] = actions[actionName] as [string, PayloadCreator];
            const actionCreator = makeActionCreator(actionType, payloadCreator);
            actionCreators[actionName] = actionCreator;
        } else if (typeof actions[actionName] === "string") {
            // defining an action creator alias
            // TODO
            console.warn("action creator alias not yet implemented");
        } else {
            throw new Error(`invalid logic: actions entry cannot be a ${typeof actions[actionName]}`);
        }
    });
    return {actionCreators, reducerHandlers, watcherCreators, actionTypes};
}

export function parseHandlers(handlers: Hashmap<any>, rootPath: string) {
    const reducerHandlers: Hashmap<ReducerHandler> = {};
    const watcherCreators: any[] = [];
    const actionTypes: string[] = [];
    Object.keys(handlers).forEach((key) => {
        // defining a handler
        let type: string;
        if (key.match("^[.]{3}")) {
            // defining type from action path
            const actionPath = key.substr(3);
            if (!actionPath.match("[a-zA-Z_[.]]*")) {
                throw new Error(`invalid logic: invalid action path "${actionPath}"`);
            }
            // defining action type from path
            // const shift = actionPath.split(".").length - 1;
            // type = makeActionType(...rootPath.split(".").slice(0, -shift), actionPath);
            type = makeActionType(...rootPath.split(".").slice(0, 1), actionPath);
        } else {
            // key is directly an action type;
            type = key;
            if (!actionTypes.includes(type)) { actionTypes.push(type); }
        }
        if (typeof handlers[key] === "function") {
            // defining reducer handler
            const handler = handlers[key] as ReducerHandler;
            reducerHandlers[type] = handler;
        } else if (isObject(handlers[key]) && !isArray(handlers[key])) {
            // defining watcher or reducer handler
            const combo = handlers[key] as HandlerCreatorCombo;
            // cannot define an action creator here
            if (combo.payload !== undefined) {
                throw new Error(`invalid logic: "${key}" cannot define an action creator`);
            }
            const result = parseCombo(combo, type);
            if (result.reducerHandler) {
                reducerHandlers[type] = result.reducerHandler;
            }
            if (result.watcherCreator) {
                watcherCreators.push(result.watcherCreator);
            }
        } else {
            throw new Error(`invalid logic: handler for "${key} must a be either a function or an object`);
        }
    });
    return {reducerHandlers, watcherCreators, actionTypes};
}

type WatcherTaker = (type: string, actions: any) => () => IterableIterator<ForkEffect>;

export type ActionWatcher = () => IterableIterator<ForkEffect>;

export type WatcherCreator = (actions: any) => ActionWatcher;

type ReducerHandler = (state: any, payload: any, error: any) => any;

export type PayloadCreator = (...args: any[]) => any;

export interface HandlerCreatorCombo { name?: string; payload: any; take?: string; handler: any; }

interface ParseComboResult {
    actionCreator?: ActionCreator;
    reducerHandler?: ReducerHandler;
    watcherCreator?: WatcherCreator;
}

function parseCombo(combo: HandlerCreatorCombo, type: string, name?: string) {
    const {payload, take, handler} = combo;
    const result: ParseComboResult = {};
    if (name && payload !== undefined) {
        const actionCreator = makeActionCreator(type, payload);
        result.actionCreator = actionCreator;
    }
    // define action handler
    if (!isFunction(handler)) {
        throw new Error(`invalid logic: handler for "${type}" must be a function`);
    }
    if (take) {
        // handler is a saga
        if (!handler) {
            throw new Error(`invalid logic: missing handler for "${type}" action watcher`);
        }
        result.watcherCreator = makeWatcherCreator(type, take, handler);
    } else {
        // handler is a reducer
        result.reducerHandler = handler;
    }
    return result;
}

function makeWatcherCreator(type: string, take: string|WatcherTaker, handler: GeneratorFunction): WatcherCreator {
    if (typeof take === "function") {
        return (actions: any) => take(type, actions);
    } else if (take === "every") {
        return (actions: any) => function* watch() {
            yield takeEvery(type, handler, actions);
        };
    } else if (take === "latest") {
        return (actions: any) => function* watch() {
            yield takeLatest(type, handler, actions);
        };
    } else {
        throw new Error(`invalid logic: wrong \"take\" value for action type "${type}"`);
    }
}

export type ActionCreator = (...args: any[]) => AnyAction;

export function makeActionCreator(type: string, payloadCreator?: any): ActionCreator {
    const actionCreator: ActionCreator = (...args: any[]) => {
        const action: AnyAction = {type};
        if (payloadCreator === undefined) { return action; }
        if (typeof payloadCreator === "function") {
            const data = payloadCreator(...args);
            if (isObject(data) && !isArray(data) && data.payload !== undefined) {
                action.payload = data.payload;
            } else {
                action.payload = data;
            }
        } else if ((payloadCreator instanceof Error || payloadCreator instanceof TypeError)) {
            action.payload = {message: payloadCreator.message};
            action.error = true;
        } else if (payloadCreator !== null) {
            throw new Error("invalid payload creator: it must be either a function, an error or a null");
        }
        return action;
    };
    actionCreator.toString = () => type;
    return actionCreator;
}

export function makeActionType(...args: string[]) {
    return args.join(".").split(".").join("__").toUpperCase();
}

export function makeActions(actionCreators: Hashmap<any>, actionTypes?: Hashmap<string>) {
    const actions: any = {};
    Object.keys(actionCreators).forEach((logicPath: string) => {
        const logicActionCreators = actionCreators[logicPath];
        Object.keys(logicActionCreators).forEach((actionPath: string) => {
            const fullPath = logicPath.split(".").slice(1).concat(actionPath.split("."));
            const createAction = logicActionCreators[actionPath];
            if (actionTypes && !actionTypes[createAction.toString()]) {
                throw new Error(`"${createAction.toString()}" is not a valid action type`);
            }
            setPath(actions, fullPath, logicActionCreators[actionPath]);
        });
    });
    if (actionTypes) {
        actions._types = actionTypes;
    }
    return actions;
}
