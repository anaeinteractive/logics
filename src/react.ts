import {
    ComponentClass,
    ComponentElement,
    Context,
    default as React,
    ReactElement,
    ReactNode,
    StatelessComponent,
} from "react";
import {Unsubscribe} from "redux";
import {getStore} from ".";
import {createLogic, LogicDescriptor} from "./logic";
import {LogicRegistryEntry, LogicsStore} from "./store";

interface LogicProviderProps {
    store?: LogicsStore;
    logic: LogicDescriptor|((options: any) => LogicDescriptor);
    name?: string;
    children?: ReactNode[];
}

interface ILogicProvider {
    (props: LogicProviderProps): ComponentElement<LogicsWrapperProps, LogicsWrapper>;
    connect: (logicPath?: ((props: any) => string)|string) => (
        ConnectedComponent: ComponentClass|StatelessComponent) => (
        props: any) => ReactElement<any>;
}

export function createLogicProvider(): ILogicProvider {
    const cache: {
        descriptor?: LogicDescriptor;
        name?: string;
        entry?: LogicRegistryEntry;
    } = {};
    let context: Context<any>;
    const LogicProvider = ({
        store = getStore(),
        logic: logicDesc,
        name,
        children,
    }: LogicProviderProps) => {
        if (!name) {
            throw new Error("connot provide logic without a name");
        }
        if (logicDesc !== cache.descriptor || name !== cache.name) {
            cache.name = name;
            cache.descriptor = logicDesc;
            if (cache.entry) {
                store.dropLogic(cache.entry.logic);
            }
            const entry = store.getLogic(name);
            if (entry) {
                throw new Error(`a logic with name "${name}" is already registered`);
            }
            cache.entry = store.registerLogic(createLogic(logicDesc)(name));
        }
        const {logic, getProps} = cache.entry as LogicRegistryEntry;
        const dropLogic = () => store.dropLogic(logic);
        const subscribe = store.subscribe;
        context = React.createContext(getProps());
        return React.createElement(LogicsWrapper, {subscribe, dropLogic, getProps, context}, children);
    };
    (LogicProvider as ILogicProvider).connect = (logicPath: ((props: any) => string)|string = "") => {
        return (ConnectedComponent: ComponentClass|StatelessComponent) => {
            return ({children, ...props}: { children?: ReactNode; props?: any; }) => {
                const {Consumer} = context;
                const propsPath: string = typeof logicPath === "function" ? logicPath(props) : logicPath;
                return React.createElement(Consumer, null, (logicProps: any) => {
                    const localProps = propsPath.split(".").reduce((o, k) => o[k], logicProps) || logicProps;
                    return React.createElement(ConnectedComponent, {...props, ...localProps}, children);
                });
            };
        };
    };
    return LogicProvider as ILogicProvider;
}

interface LogicsWrapperProps {
    subscribe: (listener: () => void) => Unsubscribe;
    dropLogic: () => void;
    getProps: () => any;
    context: Context<any>;
    children?: ReactNode[];
}

class LogicsWrapper extends React.Component<LogicsWrapperProps> {
    private unsubscribe?: () => void;
    public render() {
        const value = this.props.getProps();
        return React.createElement(this.props.context.Provider, {value}, this.props.children);
    }
    public handleChange() {
        this.forceUpdate();
    }
    public componentDidMount() {
        this.unsubscribe = this.props.subscribe(this.handleChange.bind(this));
    }
    public componentWillUnmount() {
        if (this.unsubscribe) { this.unsubscribe(); }
        this.props.dropLogic();
    }
}
