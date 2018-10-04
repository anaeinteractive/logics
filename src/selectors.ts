import { createSelector, Selector } from "reselect";
import {isArray, isFunction} from "util";
import {GetByKey, Hashmap} from "./types";

export type SelectorCreator = (getSelector: GetByKey<SelectorCreator>) => any;

export type AnySelector = Selector<any, any>;

export function parseSelectors(selectors: Hashmap<any>, rootPath: string) {
    const selectorCreators: Hashmap<SelectorCreator> = {};
    if (selectors) {
        Object.keys(selectors).forEach((selectorName) => {
            selectorCreators[selectorName] = makeSelectorCreator(selectors[selectorName], rootPath);
        });
    }
    return selectorCreators;
}

export function makeSelectorCreator(arg: any, rootPath: string): SelectorCreator {
    if (typeof arg === "string") {
        const pathArray = arg.split(".");
        const fullPath = rootPath.split(".").concat(pathArray.slice(pathArray[0] === "@state" ? 1 : 0));
        return () => (state: any) => fullPath.reduce((o: any, k: string) =>  o[k], state);
    } else if (isArray(arg)) {
        const len = arg.length;
        const fn: (...args: any[]) => any = arg.slice(-1)[0];
        return (getSelector: GetByKey<AnySelector>) => {
            const args: any[] = arg.map((part: any, i: number) => {
                if (i < len - 1) { return getSelector(part); }
                return part;
            });
            return createSelector.apply(null, args);
        };
    } else if (isFunction(arg)) {
        return () => (state: any) => {
            const localState = rootPath.split(".").reduce((o: any, k: string) => o[k], state);
            return arg(localState, state, rootPath);
        };
    } else {
        throw new TypeError("supplied argument must be either a string or an array");
    }
}

export function makeSelectors(selectorCreators: Hashmap<SelectorCreator>) {
    const selectors: Hashmap<AnySelector> = {};
    const getSelector: GetByKey<AnySelector> = (path: string): any => {
        const selector = path.split(".").reduce((o: any, k: string) => {
            if (o === undefined || o[k] === undefined) { return; } // TODO check if need throw
            return o[k];
        }, selectors);
        if (!selector) {
            const selectorCreator = selectorCreators[path];
            if (!selectorCreator) {
                throw new Error(`selector creator "${path}" not found`);
            }
            return registerSelector(selectorCreator, path);
        }
        return selector;
    };
    const registerSelector = (selectorCreator: SelectorCreator, path: string) => {
        const selector = selectorCreator(getSelector);
        selectors[path] = selector;
        return selector;
    };
    Object.keys(selectorCreators).forEach((path) => {
        const selectorCreator = selectorCreators[path];
        registerSelector(selectorCreator, path);
    });
    return selectors;
}

export function makePropsFromSelectors(selectors: Hashmap<any>, state: any, props?: any) {
    const newProps: any = {};
    Object.keys(selectors).forEach((path: string) => {
        const pathArray = path.split(".");
        if (path[0][0] === "_") { return; }
        const len = pathArray.length;
        let pointer = newProps;
        for (let i = 0; i < len; i++) {
            const part = pathArray[i];
            if (i === len - 1) {
                pointer[part] = selectors[path](state, props);
            } else {
                pointer[part] = pointer[part] || {};
                pointer = pointer[part];
            }
        }
    });
    return newProps;
}
