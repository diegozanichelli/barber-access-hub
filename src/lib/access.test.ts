import { describe, expect, test } from "bun:test";
import { classifyAuthenticatedAccess, destinationForAccess } from "./access";

describe("access resolution", () => {
  test("keeps pending and rejected users away from dashboards", () => {
    const pending = classifyAuthenticatedAccess(
      { status: "pending", requested_role: "atendente" },
      [],
    );
    const rejected = classifyAuthenticatedAccess(
      { status: "rejected", requested_role: "supervisor" },
      [],
    );
    expect(destinationForAccess(pending)).toBe("/pendente");
    expect(destinationForAccess(rejected)).toBe("/pendente");
  });

  test("routes an approved user with exactly one role", () => {
    const access = classifyAuthenticatedAccess(
      { status: "approved", requested_role: "atendente" },
      ["supervisor"],
    );
    expect(access).toEqual({ kind: "approved", role: "supervisor", route: "/supervisor" });
  });

  test("turns missing, absent or duplicate role configuration into a stable pending page", () => {
    const states = [
      classifyAuthenticatedAccess(null, []),
      classifyAuthenticatedAccess({ status: "approved", requested_role: null }, []),
      classifyAuthenticatedAccess({ status: "approved", requested_role: null }, [
        "atendente",
        "supervisor",
      ]),
    ];
    for (const state of states) {
      expect(state.kind).toBe("misconfigured");
      expect(destinationForAccess(state)).toBe("/pendente");
    }
  });
});
