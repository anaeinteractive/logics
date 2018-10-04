import {createLogic} from "./logic";
import {createStore, LogicsStore} from "./store";

export {createLogic};
export {createStore};

let store: LogicsStore;

export function getStore() {
    store = store || createStore();
    return store;
}

export default {
    createLogic,
    createStore,
    getStore,
};
