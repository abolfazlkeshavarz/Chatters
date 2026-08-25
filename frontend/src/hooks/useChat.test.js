import { advanceStatus } from "./useChat";

// Delivery state drives the bubble colour, so a regression here shows up as a
// message visibly changing from green back to blue in front of the user.
describe("advanceStatus", () => {
  test("advances through the states in order", () => {
    expect(advanceStatus("sent", "delivered")).toBe("delivered");
    expect(advanceStatus("delivered", "seen")).toBe("seen");
    expect(advanceStatus("sent", "seen")).toBe("seen");
  });

  test("never moves backwards", () => {
    // The case this exists for: a reconnect's delivery sweep lands just after
    // the read receipt for the same message.
    expect(advanceStatus("seen", "delivered")).toBe("seen");
    expect(advanceStatus("seen", "sent")).toBe("seen");
    expect(advanceStatus("delivered", "sent")).toBe("delivered");
  });

  test("staying in the same state is a no-op", () => {
    expect(advanceStatus("sent", "sent")).toBe("sent");
    expect(advanceStatus("delivered", "delivered")).toBe("delivered");
    expect(advanceStatus("seen", "seen")).toBe("seen");
  });

  test("ignores an unrecognised incoming state", () => {
    expect(advanceStatus("delivered", "nonsense")).toBe("delivered");
    expect(advanceStatus("delivered", undefined)).toBe("delivered");
  });

  test("treats an unknown current state as the earliest one", () => {
    // A message rendered before its status was known must still be able to
    // advance rather than getting stuck.
    expect(advanceStatus(undefined, "delivered")).toBe("delivered");
    expect(advanceStatus(undefined, "seen")).toBe("seen");
  });
});
