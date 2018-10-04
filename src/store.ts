import {
    applyMiddleware, combineReducers, compose,
    createStore as createReduxStore, DeepPartial, Middleware,
    Reducer, Store, StoreCreator, StoreEnhancer,
} from "redux";
import createSagaMiddleware, { Effect, Task } from "redux-saga";
import {call, cancel} from "redux-saga/effects";
import {Logic, makeGetProps} from "./logic";
import {Hashmap} from "./types";

const windowIfDefined = typeof window === "undefined" ? null : window as any;
const composeEnhancers = windowIfDefined.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

export interface StoreConfig {
    state?: DeepPartial<{}>;
    reducers?: {[name: string]: any};
    middlewares?: Middleware[];
    enhancers?: StoreEnhancer[];
}

export interface LogicsStore extends Store {
    injectReducers: (reducers: {[name: string]: Reducer}) => void;
    removeReducers: (reducers: string[]) => void;
    registerLogic: (logic: Logic) => LogicRegistryEntry;
    dropLogic: (logic: Logic) => void;
    getLogic: (logicName: string) => LogicRegistryEntry|undefined;
}

export function reducerInjector(reduxCreateStore: StoreCreator): StoreCreator {
    const reducers: Hashmap<Reducer> = {};
    return (reducer: Reducer, preloadedState: any, enhancer?: StoreEnhancer) => {
        const store = reduxCreateStore(reducer, preloadedState, enhancer);
        (store as LogicsStore).injectReducers = (newReducers: Hashmap<Reducer>) => {
            Object.keys(newReducers).forEach((r) => {
                if (reducers[r]) {
                    throw new Error(`cannot inject reducer: a reducer with name "${r}" already exists`);
                }
                reducers[r] = newReducers[r];
            });
            store.replaceReducer(combineReducers(reducers));
            store.dispatch({type: ""});
        };
        (store as LogicsStore).removeReducers = (names: string[]) => {
            names.forEach((name) => delete reducers[name]);
            store.replaceReducer(combineReducers(reducers));
            store.dispatch({type: ""});
        };
        return store;
    };
}

export interface LogicRegistry {
    [path: string]: LogicRegistryEntry;
}

export interface LogicRegistryEntry {
    logic: Logic;
    getProps: (props?: any) => any;
    watchers: Task[];
}

function createLogicRegistry(store: LogicsStore, runSaga: ((saga: any) => any)) {
    const logics: LogicRegistry = {};

    const register = (logic: Logic) => {
        const entry = logics[logic.name];
        if (entry) {
            throw new Error(`cannot register logic : a logic named "${logic.name}" is already registred`);
        } else {
            const getProps = makeGetProps(logic, store);
            const watchers = logic.watchers.map(runSaga);
            logics[logic.name] = {logic, getProps, watchers};
            if (logic.reducer) {
                store.injectReducers({[logic.name]: logic.reducer});
            }
            return logics[logic.name];
        }
    };
    const drop = (logic: Logic) => {
        const entry = logics[logic.name];
        if (entry) {
            runSaga(function *() {
                yield entry.watchers.map((task) => cancel(task));
                yield call(store.removeReducers, [logic.name]);
            });

        } else {
            throw Error(`cannot drop unregisterd logic "${logic.name}"`);
        }
    };
    const get = (logicName: string) => logics[logicName];

    return {register, drop, get};

}

export function createStore(config: StoreConfig = {}): LogicsStore {
    const initialState = config.state || {};

    const middlewares = config.middlewares || [];
    const sagaMiddleware = createSagaMiddleware();
    middlewares.push(sagaMiddleware);

    const enhancers = [applyMiddleware(...middlewares), reducerInjector, ...(config.enhancers || [])];
    const storeEnhancer: StoreEnhancer = composeEnhancers(...enhancers);

    const rootReducer: Reducer = (state: {[key: string]: any} = {}) => state;

    const store = createReduxStore(rootReducer, initialState, storeEnhancer) as LogicsStore;

    const logicRegistry = createLogicRegistry(store, sagaMiddleware.run);

    store.registerLogic = logicRegistry.register;
    store.dropLogic = logicRegistry.drop;
    store.getLogic = logicRegistry.get;

    return store;
}

// export function createSimpleStore(reducer: any) {
//     let state: any = reducer(undefined, {type: "@@INIT"});
//     let dispatching = false;
//     const listeners: any[] = [];
//     return {
//         dispatch(action: any) {
//             if (dispatching) { throw new Error("cannot dispatch in a reducer"); }
//             dispatching = true;
//             state = reducer(state, action);
//             listeners.forEach((listener: any) => listener());
//             dispatching = false;
//         },
//         getState() {
//             return state;
//         },
//         subscribe(listener: any) {
//             listeners.push(listener);
//             return () => {
//                 const index: number = listeners.indexOf(listener);
//                 if (index >= 0) { listeners.splice(index, 1); }
//             };
//         },
//     };
// }
