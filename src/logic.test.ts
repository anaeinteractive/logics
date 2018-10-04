import {createLogic} from "./logic";

describe("createLogic", () => {
    test("returns result", () => {
        const logicName = "test";
        const logic = createLogic({})(logicName);
        expect(logic).toHaveProperty("actions");
        expect(logic).toHaveProperty("reducer");
    });
});
