export interface Hashmap<T> {
    [key: string]: T;
}

export type GetByKey<T> = (key: string) => T;
