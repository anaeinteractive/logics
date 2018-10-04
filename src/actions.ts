import {AnyAction, Dispatch} from "redux";
import {ForkEffect, takeEvery, takeLatest} from "redux-saga/effects";
import {isArray, isFunction, isObject} from "util";
import {Hashmap} from "./types";

export function parseActions(actions: Hashmap<any>, rootPath: string) {
    const actionCreators: Hashmap<ActionCreator> = {};
    const reducerHandlers: Hashmap<ReducerHandler> = {};
    const watcherCreators: any[] = [];
    const actionTypes: string[] = [];
    Object.keys(actions).forEach((key) => {
        if (key.match("^[.]{3}[^.]*$")) {
            // key is an action name
            const actionName = key.substr(3);
            if (!actionName.match("^[a-zA-Z_]*$")) {
                throw new Error(`invalid logic: "${actionName}" is not a valid action name`);
            }
            if (isObject(actions[key]) && !isArray(actions[key])) {
                // defining combo (action creator + handler)
                const combo = actions[key] as HandlerCreatorCombo;
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
            } else if (isFunction(actions[key])) {
                // defining a handler for the reducer;
                const type = makeActionType(...rootPath.split("."), actionName);
                reducerHandlers[type] = actions[key] as ReducerHandler;
                if (!actionTypes.includes(type)) { actionTypes.push(type); }
            } else if (isArray(actions[key])) {
                // defining an action creator
                const [actionType, payloadCreator] = actions[key] as [string, PayloadCreator];
                const actionCreator = makeActionCreator(actionType, payloadCreator);
                actionCreators[actionName] = actionCreator;
            } else if (typeof actions[key] === "string") {
                // defining an action creator alias
                // TODO
                console.warn("action creator alias not yet implemented");
            } else {
                throw new Error(`invalid logic: actions entry cannot be a ${typeof actions[key]}`);
            }
        } else {
            // defining a handler
            let type: string;
            if (key.match("^[.]{3}")) {
                // defining type from action path
                const actionPath = key.substr(3);
                if (!actionPath.match("[a-zA-Z_[.]]*")) {
                    throw new Error(`invalid logic: wrong action path "${actionPath}"`);
                }
                // defining action type from path
                const shift = actionPath.split(".").length - 1;
                type = makeActionType(...rootPath.split(".").slice(0, -shift), actionPath);
            } else {
                // key is directly an action type;
                type = key;
            }
            if (typeof actions[key] === "function") {
                // defining reducer handler
                const handler = actions[key] as ReducerHandler;
                reducerHandlers[type] = handler;
            } else if (isObject(actions[key]) && !isArray(actions[key])) {
                // defining watcher or reducer handler
                const combo = actions[key] as HandlerCreatorCombo;
                // cannot define an action creator here
                if (combo.payload !== undefined) {
                    throw new Error(`invalid logic: "${key}" is not a valid action name`);
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
            if (!actionTypes.includes(type)) { actionTypes.push(type); }
        }
    });
    return {actionCreators, reducerHandlers, watcherCreators, actionTypes};
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
        throw new Error("invalid logic: wrong \"take\" value");
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

export function makeActions(actionCreators: Hashmap<any>, dispatch: Dispatch, actionTypes?: Hashmap<string>) {
    const actions: any = {};
    Object.keys(actionCreators).forEach((path: string) => {
        const create = actionCreators[path];
        const pathArray = path.split(".");
        const len = pathArray.length;
        let pointer = actions;
        for (let i = 0; i < len; i++) {
            const part = pathArray[i];
            if (i === len - 1) {
                if (actionTypes && !actionTypes[create.toString()]) {
                    throw new Error(`"${create.toString()}" is not a valid action type`);
                }
                pointer[part] = (...args: any[]) => dispatch(create(...args));
            } else {
                pointer[part] = pointer[part] || {};
                pointer = pointer[part];
            }
        }
    });
    return actions;
}
