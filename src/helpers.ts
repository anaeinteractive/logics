import {Hashmap} from "./types";
export const isPlainObject = (o: any) => (typeof o === "object" && o !== null && !Array.isArray(o));

export function setPath(o: Hashmap<any>, path: string|string[], value: any) {
    let pointer = o;
    const pathParts = Array.isArray(path) ? path : path.split(".");
    const depth = pathParts.length - 1;
    pathParts.forEach((part, idx) => {
        if (idx === depth ) {
            pointer[part] = value;
        } else {
            pointer[part] = pointer[part] || {};
            pointer = pointer[part];
        }
    });
    return o;
}

export function getPath(o: Hashmap<any>, path: string|string[]) {
    const pathParts = Array.isArray(path) ? path : path.split(".");
    return pathParts.reduce((ptr, k) => ptr[k], o);
}
