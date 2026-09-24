import { describe, expect, it } from "vitest";
import { NUSKHA_NAMESPACE, uuidV5 } from "./uuid.ts";

const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("uuidV5", () => {
  // Published vectors: the Python uuid module and RFC 9562 appendix A.4 both
  // give these, so a wrong SHA-1 cannot pass by agreeing with itself.
  it("matches the published vector for www.example.com", () => {
    expect(uuidV5(DNS, "www.example.com")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("matches the published vector for python.org", () => {
    expect(uuidV5(DNS, "python.org")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
  });

  it("handles names longer than one SHA-1 block and non-ASCII text", () => {
    const long = `${"x".repeat(200)} नुस्ख़ा`;
    expect(uuidV5(DNS, long)).toBe(uuidV5(DNS, long));
    expect(uuidV5(DNS, long)).not.toBe(uuidV5(DNS, `${long}!`));
    expect(uuidV5(DNS, long)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("encodes names as UTF-8, across one- to four-byte characters", () => {
    // Reference computed independently with node:crypto's SHA-1 over
    // Buffer.from(name, "utf8"), so this checks the hand-written encoder.
    expect(uuidV5(DNS, "नुस्ख़ा 💊 é")).toBe("f4e17491-90ac-59e0-a32b-27d2d519ca2e");
  });

  it("derives Nuskha's namespace from the project URL", () => {
    const URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
    expect(uuidV5(URL_NAMESPACE, "https://github.com/AryanDevel/Nuskha")).toBe(NUSKHA_NAMESPACE);
  });
});
