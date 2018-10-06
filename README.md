# Logics

## What Is Logics?
Logics is a library for defining and organizing the state of an application and the logic to manage it in the form of composable logics. It is built has a thin layer on top of [Redux](https://github.com/reduxjs/redux), [Redux-Saga](https://github.com/redux-saga/redux-saga) and [Reselect](https://github.com/reduxjs/reselect).

## How Does It Work?
Working with Redux usually implies having to define action types, action creators, and reducers in different files. Other files defining sagas and selectors also probably have to be added. This tends to make the code verbous and can lead to a certain complexity.
Instead Logics defines the logic of an app in self contained and composable "logics":
```js
const counterLogic = {
    state: {
        count: 0,
        step: 1,
    },
    actions: {
        decrement: {
            payload: (step) => step,
            handler: (state, step) => ({...state, count: state.count - step})
        },
        increment: {
            payload: (step) => step,
            handler: (state, step) => ({...state, count: state.count + step})
        },
    },
    selectors: {
        count: "@state.count"
    },
};
```

## Getting Started

### Installation
    npm install logics

### Defining Logics

```js
// /logics/display.js
export default {
    state { // define the default state
        message: "",
        status: "",
    },
    actions: {
        set: { // define an action
            payload: (message, status) => ({message, status}), // function to build the payload of this action (for action creator)
            handler: (state, {message, status=""}) => ({...state, message, status}) // reducer to handle this action
        },
        clear: { // define an other action
            payload: null, // null means that the action will have no payload,
            handler: () => ({message: "", status: ""})
        },
    },
};
```

```js
// /logics/counter.js
export default ({defaultStep=1}) => { // define a configurable logic: (options) => logic
    state: {
        count: 0,
        step: defaultStep,
    },
    actions: {
        decrement: {
            payload: (step) => step,
            handler: (state, step) => ({...state, count: state.count - step})
        },
        increment: {
            payload: (step) => step,
            handler: (state, step) => ({...state, count: state.count + step})
        },
        setStep: {
            payload: (value) => value,
            handler: (state, value) => ({...state, step: value})
        },
    },
    selectors: {
        count: "@state.count",
    },
};
```

```js
// /logics/main.js
import api from "../api"; // import an hypothetic API
import {call, put} from "logics/effects";
import displayLogic from "./display-logic";
import counterLogic from "./counter-logic";

export default = {
    __display: displayLogic, // use displayLogic as sub-logic
    __counter: { // use counterLogic as sub-logic
        logic: counterLogic(5), // logic will is merged to be extended
        actions: {
        saveCount: {
            payload: (state) => state.count,
            take: "latest", // take parameter indicates that hadler defines a saga
            handler: function* (actions, {payload}) {
                try {
                    yield put(actions.display.set("saving count..."));
                    yield call(api.saveCount(payload));
                    yield put(actions.display.set("count saved", "success"));
                } catch (e) {
                    yield put(actions.display.set("error saving count", "error"));
                }
            }
        },
    },
};
```
### Using Logics With React

```jsx
// /components/counter.jsx
import React from "react";
import {connect} from "logics/react";

const Counter = ({count, step, actions}) => {
    const increment = () => actions.increment(step);
    const decrement = () => actions.decrement(step);
    const updateStep = (e) => {
        const value = parseInt(e.currentTarget.value, 10);
        actions.setStep(value);
    };
    const saveCount = () => actions.saveCount(count)
    return (
        <div>
            <button onClick={decrement}>-</button> | {count} | <button onClick={increment}>+</button><br/>
            <br/>
            <span>step: </span><input type="text" value={step} onChange={updateStep}/><br/>
            <br/>
            <button conClick={saveCount}>Save</button>
        </div>
    );
};

export default connect("counter")(Counter);
```

```jsx
// /components/display.jsx
import React from "react";
import {connect} from "logics/react";

export Display = ({message, status}) => (
    <div class="status">{message}</div>
);

export defaut connect("display")(Display);
```

```jsx
// /app.jsx
import React from "react";
import ReactDOM from "react-dom";
import {createLogicProvider} from "logics/react";
import Counter from "./components/counter";
import Display from "./components/display";
import mainLogic from "./logics/main";

const LogicProvider = createLogicProvider();

const App = () => {
    const {getContext} = LogicProvider;
    return (
        <LogicProvider logic={mainLogic} name="app">
            <Display getContext={getContext} />
            <br/>
            <Counter getContext={getContext} />
        </LogicProvider>
    );
};

ReactDOM.render(React.createElement(App), document.getElementById("app"));
```

## Licence
The MIT License

Copyright (c) 2018 ANAE INTERACTIVE