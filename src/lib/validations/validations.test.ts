import { describe, expect, it } from "vitest";

import {
  confirmPhoneSchema,
  contactIdSchema,
  createContactSchema,
  patterns,
  phoneInputSchema,
  updateContactSchema,
  validateInput,
  verificationCodeSchema,
} from ".";

// validateInput

describe("validateInput", () => {
  it("returns success with parsed data for valid input", () => {
    const result = validateInput(patterns.email, "test@example.com");
    expect(result).toEqual({ success: true, data: "test@example.com" });
  });

  it("returns error string for invalid input", () => {
    const result = validateInput(patterns.email, "not-an-email");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });

  it("returns error for wrong type", () => {
    const result = validateInput(patterns.positiveInt, "hello");
    expect(result.success).toBe(false);
  });
});

// patterns

describe("patterns", () => {
  describe("uuid", () => {
    it("accepts valid UUID v4", () => {
      const result = validateInput(
        patterns.uuid,
        "550e8400-e29b-41d4-a716-446655440000"
      );
      expect(result.success).toBe(true);
    });

    it("rejects non-UUID strings", () => {
      expect(validateInput(patterns.uuid, "not-a-uuid").success).toBe(false);
    });
  });

  describe("email", () => {
    it("accepts valid email", () => {
      expect(validateInput(patterns.email, "user@example.com").success).toBe(
        true
      );
    });

    it("rejects invalid email", () => {
      expect(validateInput(patterns.email, "user@").success).toBe(false);
    });
  });

  describe("url", () => {
    it("accepts https URL", () => {
      expect(validateInput(patterns.url, "https://example.com").success).toBe(
        true
      );
    });

    it("accepts http URL", () => {
      expect(validateInput(patterns.url, "http://example.com").success).toBe(
        true
      );
    });

    it("rejects non-URL strings", () => {
      expect(validateInput(patterns.url, "not a url").success).toBe(false);
    });
  });

  describe("nonEmptyString", () => {
    it("accepts non-empty string", () => {
      expect(validateInput(patterns.nonEmptyString, "hello").success).toBe(
        true
      );
    });

    it("rejects empty string", () => {
      expect(validateInput(patterns.nonEmptyString, "").success).toBe(false);
    });
  });

  describe("positiveInt", () => {
    it("accepts positive integers", () => {
      expect(validateInput(patterns.positiveInt, 5).success).toBe(true);
    });

    it("rejects zero", () => {
      expect(validateInput(patterns.positiveInt, 0).success).toBe(false);
    });

    it("rejects negative numbers", () => {
      expect(validateInput(patterns.positiveInt, -1).success).toBe(false);
    });

    it("rejects floats", () => {
      expect(validateInput(patterns.positiveInt, 1.5).success).toBe(false);
    });
  });

  describe("nonNegativeInt", () => {
    it("accepts zero", () => {
      expect(validateInput(patterns.nonNegativeInt, 0).success).toBe(true);
    });

    it("accepts positive integers", () => {
      expect(validateInput(patterns.nonNegativeInt, 10).success).toBe(true);
    });

    it("rejects negative numbers", () => {
      expect(validateInput(patterns.nonNegativeInt, -1).success).toBe(false);
    });
  });
});

// phone schemas

describe("phone schemas", () => {
  it("accepts a phone string and trims it", () => {
    const result = validateInput(phoneInputSchema, {
      phone: " +1 415 555 2671 ",
    });
    expect(result).toEqual({
      success: true,
      data: { phone: "+1 415 555 2671" },
    });
  });

  it("rejects an empty phone", () => {
    expect(validateInput(phoneInputSchema, { phone: "  " }).success).toBe(
      false
    );
  });

  it("rejects an overlong phone", () => {
    expect(
      validateInput(phoneInputSchema, { phone: "+".padEnd(40, "1") }).success
    ).toBe(false);
  });

  it("accepts a six-digit code", () => {
    expect(validateInput(verificationCodeSchema, "123456")).toEqual({
      success: true,
      data: "123456",
    });
  });

  it.each(["12345", "1234567", "12345a", "", "12 34 56"])(
    "rejects code %j",
    (code) => {
      expect(validateInput(verificationCodeSchema, code).success).toBe(false);
    }
  );

  it("accepts the confirm payload with an optional timezone", () => {
    expect(
      validateInput(confirmPhoneSchema, {
        phone: "+14155552671",
        code: "123456",
        timezone: "America/New_York",
      }).success
    ).toBe(true);
    expect(
      validateInput(confirmPhoneSchema, {
        phone: "+14155552671",
        code: "123456",
      }).success
    ).toBe(true);
  });

  it("rejects the confirm payload with a bad code", () => {
    expect(
      validateInput(confirmPhoneSchema, { phone: "+14155552671", code: "12" })
        .success
    ).toBe(false);
  });
});

// contact schemas

describe("contact schemas", () => {
  it("accepts a name and phone and trims both", () => {
    expect(
      validateInput(createContactSchema, {
        name: "  Mike Anderson ",
        phone: " +1 415 555 2671 ",
      })
    ).toEqual({
      success: true,
      data: { name: "Mike Anderson", phone: "+1 415 555 2671" },
    });
  });

  it("rejects a blank name", () => {
    expect(
      validateInput(createContactSchema, { name: "   ", phone: "+14155552671" })
        .success
    ).toBe(false);
  });

  it("accepts a name of exactly 100 characters", () => {
    expect(
      validateInput(createContactSchema, {
        name: "a".repeat(100),
        phone: "+14155552671",
      }).success
    ).toBe(true);
  });

  it("rejects a name over 100 characters", () => {
    expect(
      validateInput(createContactSchema, {
        name: "a".repeat(101),
        phone: "+14155552671",
      }).success
    ).toBe(false);
  });

  it("rejects an empty phone", () => {
    expect(
      validateInput(createContactSchema, { name: "Mike", phone: "" }).success
    ).toBe(false);
  });

  it("requires an id on update", () => {
    expect(
      validateInput(updateContactSchema, {
        name: "Mike",
        phone: "+14155552671",
      }).success
    ).toBe(false);
    expect(
      validateInput(updateContactSchema, {
        id: "c1",
        name: "Mike",
        phone: "+14155552671",
      }).success
    ).toBe(true);
  });

  it("rejects a blank id", () => {
    expect(validateInput(contactIdSchema, { id: " " }).success).toBe(false);
  });

  it("coerces a speed dial given as a form string", () => {
    expect(
      validateInput(createContactSchema, {
        name: "Mike",
        phone: "+14155552671",
        speedDial: " 12 ",
      })
    ).toEqual({
      success: true,
      data: { name: "Mike", phone: "+14155552671", speedDial: 12 },
    });
  });

  it("treats an empty or missing speed dial as automatic", () => {
    const empty = validateInput(createContactSchema, {
      name: "Mike",
      phone: "+14155552671",
      speedDial: "",
    });
    expect(empty).toEqual({
      success: true,
      data: { name: "Mike", phone: "+14155552671" },
    });
    const missing = validateInput(updateContactSchema, {
      id: "c1",
      name: "Mike",
      phone: "+14155552671",
    });
    expect(missing.success && missing.data.speedDial).toBeUndefined();
  });

  it("rejects a speed dial that is not a whole number from 1 to 9999", () => {
    for (const speedDial of ["0", "-3", "1.5", "10000", "abc"]) {
      const result = validateInput(createContactSchema, {
        name: "Mike",
        phone: "+14155552671",
        speedDial,
      });
      expect(result.success, speedDial).toBe(false);
    }
    expect(
      validateInput(updateContactSchema, {
        id: "c1",
        name: "Mike",
        phone: "+14155552671",
        speedDial: "9999",
      }).success
    ).toBe(true);
  });
});
