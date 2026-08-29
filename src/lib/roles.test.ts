import { describe, expect, test } from "bun:test";
import { roleRequiresUnit } from "./roles";

describe("role unit scope", () => {
  test("requires a unit only for operational roles", () => {
    expect(roleRequiresUnit("atendente")).toBe(true);
    expect(roleRequiresUnit("supervisor")).toBe(true);
    expect(roleRequiresUnit("socio")).toBe(false);
    expect(roleRequiresUnit("auditor")).toBe(false);
  });
});
