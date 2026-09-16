import { describe, expect, it } from "vitest";

import {
  alreadyConnecting,
  apology,
  confirmPrompt,
  contactHints,
  dial,
  disambiguationPrompt,
  gatherPrompt,
  goodbyeNotFound,
  keypadFallbackPrompt,
  noContacts,
  notRegistered,
  postDialOutcome,
  unavailable,
  type VoiceSettings,
} from "./twiml";

const ACTION =
  "https://abc-3000.app.github.dev/api/twilio/gather?callId=c1&attempt=1";
const UNSAFE_NAME = '<a>&"Mike';
const SETTINGS: VoiceSettings = {
  voice: "Polly.Joanna-Neural",
  speechModel: "deepgram_nova-3",
};

/** Attribute value of the first element carrying `name`, entity-encoded as written. */
function attribute(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

/** Every <Say> opening tag in the document. */
function sayTags(xml: string): string[] {
  return xml.match(/<Say[^>]*>/g) ?? [];
}

function dialOptions(settings: VoiceSettings = SETTINGS) {
  return {
    settings,
    to: "+15559876543",
    callerId: "+15005550006",
    actionUrl:
      "https://abc-3000.app.github.dev/api/twilio/dial-status?callId=c1",
    recordingStatusCallbackUrl:
      "https://abc-3000.app.github.dev/api/twilio/recording?callId=c1",
    amdStatusCallbackUrl:
      "https://abc-3000.app.github.dev/api/twilio/amd-status?callId=c1",
  };
}

describe("twiml builders", () => {
  it("notRegistered snapshot", () => {
    expect(notRegistered(SETTINGS)).toMatchSnapshot();
  });

  it("noContacts snapshot", () => {
    expect(noContacts(SETTINGS)).toMatchSnapshot();
  });

  it("gatherPrompt snapshot for the first attempt with the caller's first name", () => {
    expect(
      gatherPrompt({
        settings: SETTINGS,
        actionUrl: ACTION,
        hints: ["Mike Anderson", "Sarah Chen"],
        callerFirstName: "Sanjeev",
      })
    ).toMatchSnapshot();
  });

  it("gatherPrompt greets without a name when the caller has none", () => {
    const xml = gatherPrompt({
      settings: SETTINGS,
      actionUrl: ACTION,
      hints: ["Mike Anderson"],
      callerFirstName: "",
    });
    expect(xml).toContain(
      '<Say voice="Polly.Joanna-Neural">Hi. Who would you like to call?</Say>'
    );
  });

  it("gatherPrompt first prompt is short: no keypad tip", () => {
    const xml = gatherPrompt({
      settings: SETTINGS,
      actionUrl: ACTION,
      hints: [],
      callerFirstName: "Sanjeev",
    });
    expect(xml).toContain("Hi Sanjeev. Who would you like to call?</Say>");
    expect(xml).not.toContain("speed dial");
  });

  it("gatherPrompt snapshot when speech was heard but not matched", () => {
    expect(
      gatherPrompt({
        settings: SETTINGS,
        actionUrl: ACTION,
        hints: ["Mike Anderson"],
        heard: "my canderson",
      })
    ).toMatchSnapshot();
  });

  it("gatherPrompt snapshot when nothing was heard", () => {
    expect(
      gatherPrompt({
        settings: SETTINGS,
        actionUrl: ACTION,
        hints: ["Mike Anderson"],
        noSpeech: true,
      })
    ).toMatchSnapshot();
  });

  it("gatherPrompt after a declined confirmation asks again with the keypad tip", () => {
    const xml = gatherPrompt({
      settings: SETTINGS,
      actionUrl: ACTION,
      hints: ["Mike Anderson"],
    });
    expect(xml).toContain(
      "No problem. Who would you like to call? You can also press their speed dial, then pound."
    );
  });

  it("gatherPrompt accepts speech and DTMF in one verb with the plan's settings", () => {
    const xml = gatherPrompt({
      settings: SETTINGS,
      actionUrl: ACTION,
      hints: ["Mike Anderson"],
    });
    expect(attribute(xml, "input")).toBe("speech dtmf");
    expect(attribute(xml, "speechModel")).toBe("deepgram_nova-3");
    expect(attribute(xml, "speechTimeout")).toBe("2");
    expect(attribute(xml, "language")).toBe("en-US");
    expect(attribute(xml, "actionOnEmptyResult")).toBe("true");
    expect(attribute(xml, "finishOnKey")).toBe("#");
    expect(attribute(xml, "method")).toBe("POST");
    expect(attribute(xml, "action")).toBe(
      "https://abc-3000.app.github.dev/api/twilio/gather?callId=c1&amp;attempt=1"
    );
  });

  it("confirmPrompt snapshot", () => {
    expect(
      confirmPrompt({
        settings: SETTINGS,
        actionUrl: ACTION,
        contactName: "Mike Anderson",
      })
    ).toMatchSnapshot();
  });

  it("confirmPrompt accepts one digit or a yes/no word", () => {
    const xml = confirmPrompt({
      settings: SETTINGS,
      actionUrl: ACTION,
      contactName: "Mike Anderson",
    });
    expect(attribute(xml, "input")).toBe("speech dtmf");
    expect(attribute(xml, "numDigits")).toBe("1");
    expect(attribute(xml, "timeout")).toBe("5");
    expect(attribute(xml, "speechTimeout")).toBe("2");
    expect(attribute(xml, "speechModel")).toBe("deepgram_nova-3");
    expect(attribute(xml, "hints")).toBe("yes, no, one, two");
    expect(attribute(xml, "actionOnEmptyResult")).toBe("true");
    expect(xml).toContain(
      "Mike Anderson. Press 1 or say yes to call, or 2 to try again."
    );
  });

  it("disambiguationPrompt snapshot", () => {
    expect(
      disambiguationPrompt({
        settings: SETTINGS,
        actionUrl: ACTION,
        candidates: [{ name: "Mike Anderson" }, { name: "Mike Brown" }],
      })
    ).toMatchSnapshot();
  });

  it("disambiguationPrompt reads at most four numbered options", () => {
    const xml = disambiguationPrompt({
      settings: SETTINGS,
      actionUrl: ACTION,
      candidates: [
        { name: "One" },
        { name: "Two" },
        { name: "Three" },
        { name: "Four" },
        { name: "Five" },
      ],
    });
    expect(xml).toContain(
      "I found a few. Press 1 for One, 2 for Two, 3 for Three, 4 for Four."
    );
    expect(xml).not.toContain("Five");
    expect(attribute(xml, "numDigits")).toBe("1");
    expect(attribute(xml, "input")).toBe("dtmf");
  });

  it("keypadFallbackPrompt snapshot", () => {
    expect(
      keypadFallbackPrompt({ settings: SETTINGS, actionUrl: ACTION })
    ).toMatchSnapshot();
  });

  it("alreadyConnecting snapshot", () => {
    expect(alreadyConnecting(SETTINGS)).toMatchSnapshot();
  });

  it("dial snapshot", () => {
    expect(dial(dialOptions())).toMatchSnapshot();
  });

  it("dial says 'Connecting you now' once before the Dial verb", () => {
    const xml = dial(dialOptions());
    expect(sayTags(xml)).toHaveLength(1);
    expect(xml.indexOf("Connecting you now.")).toBeLessThan(
      xml.indexOf("<Dial")
    );
    expect(xml).not.toContain("<Hangup");
  });

  it("dial enables answering machine detection on the Number noun with the AMD callback", () => {
    const xml = dial({
      ...dialOptions(),
      actionUrl: "https://x/dial",
      recordingStatusCallbackUrl: "https://x/rec",
      amdStatusCallbackUrl: "https://x/amd?callId=c1&x=1",
    });
    const number = xml.match(/<Number[^>]*>/)?.[0] ?? "";
    expect(attribute(number, "machineDetection")).toBe("DetectMessageEnd");
    expect(attribute(number, "amdStatusCallback")).toBe(
      "https://x/amd?callId=c1&amp;x=1"
    );
    expect(attribute(number, "amdStatusCallbackMethod")).toBe("POST");
    const dialVerb = xml.match(/<Dial[^>]*>/)?.[0] ?? "";
    expect(dialVerb).not.toContain("machineDetection");
  });

  it("dial records dual-channel from answer with a 30 minute limit", () => {
    const xml = dial(dialOptions());
    const dialVerb = xml.match(/<Dial[^>]*>/)?.[0] ?? "";
    expect(attribute(dialVerb, "record")).toBe("record-from-answer-dual");
    expect(attribute(dialVerb, "timeLimit")).toBe("1800");
    expect(attribute(dialVerb, "recordingStatusCallbackEvent")).toBe(
      "completed absent"
    );
    expect(attribute(dialVerb, "recordingStatusCallbackMethod")).toBe("POST");
    expect(attribute(dialVerb, "method")).toBe("POST");
    expect(attribute(dialVerb, "callerId")).toBe("+15005550006");
    expect(xml).toMatch(/<Number[^>]*>\+15559876543<\/Number>/);
  });

  it.each(["busy", "no-answer", "failed", "completed"] as const)(
    "postDialOutcome(%s) snapshot",
    (kind) => {
      expect(
        postDialOutcome(kind, {
          settings: SETTINGS,
          contactName: "Mike Anderson",
        })
      ).toMatchSnapshot();
    }
  );

  it("postDialOutcome names the contact for busy and no answer", () => {
    const options = { settings: SETTINGS, contactName: "Sarah Chen" };
    expect(postDialOutcome("busy", options)).toContain(
      "Sarah Chen is busy right now. Try again later. Bye for now."
    );
    expect(postDialOutcome("no-answer", options)).toContain(
      "Sarah Chen didn't pick up. Try again later. Bye for now."
    );
    expect(postDialOutcome("failed", options)).not.toContain("Sarah Chen");
    expect(postDialOutcome("completed", options)).toContain(">Bye for now.<");
  });

  it("goodbyeNotFound snapshot", () => {
    expect(goodbyeNotFound(SETTINGS)).toMatchSnapshot();
  });

  it("apology snapshot", () => {
    expect(apology(SETTINGS)).toMatchSnapshot();
  });

  it("unavailable snapshot", () => {
    expect(unavailable(SETTINGS)).toMatchSnapshot();
  });

  function everyBuilder(settings: VoiceSettings): string[] {
    return [
      notRegistered(settings),
      noContacts(settings),
      gatherPrompt({ settings, actionUrl: ACTION, hints: [] }),
      confirmPrompt({ settings, actionUrl: ACTION, contactName: "A" }),
      disambiguationPrompt({
        settings,
        actionUrl: ACTION,
        candidates: [{ name: "A" }],
      }),
      keypadFallbackPrompt({ settings, actionUrl: ACTION }),
      alreadyConnecting(settings),
      dial(dialOptions(settings)),
      postDialOutcome("busy", { settings, contactName: "A" }),
      goodbyeNotFound(settings),
      apology(settings),
      unavailable(settings),
    ];
  }

  it("every builder returns a TwiML document with a Response root", () => {
    for (const doc of everyBuilder(SETTINGS)) {
      expect(
        doc.startsWith('<?xml version="1.0" encoding="UTF-8"?><Response>')
      ).toBe(true);
      expect(doc.endsWith("</Response>")).toBe(true);
    }
  });

  describe("voice and speech model plumbing", () => {
    const custom: VoiceSettings = {
      voice: "Google.en-US-Chirp3-HD-Aoede",
      speechModel: "deepgram_nova-3",
    };

    it("every Say in every builder carries the configured voice", () => {
      for (const doc of everyBuilder(custom)) {
        const tags = sayTags(doc);
        expect(tags.length).toBeGreaterThan(0);
        for (const tag of tags) {
          expect(attribute(tag, "voice")).toBe("Google.en-US-Chirp3-HD-Aoede");
        }
      }
    });

    it("every speech Gather carries the configured speech model", () => {
      const speechGathers = [
        gatherPrompt({ settings: custom, actionUrl: ACTION, hints: [] }),
        confirmPrompt({
          settings: custom,
          actionUrl: ACTION,
          contactName: "A",
        }),
      ];
      for (const doc of speechGathers) {
        expect(attribute(doc, "speechModel")).toBe("deepgram_nova-3");
      }
    });

    it("keypad-only Gathers carry no speech model", () => {
      const keypadGathers = [
        disambiguationPrompt({
          settings: custom,
          actionUrl: ACTION,
          candidates: [{ name: "A" }],
        }),
        keypadFallbackPrompt({ settings: custom, actionUrl: ACTION }),
      ];
      for (const doc of keypadGathers) {
        expect(attribute(doc, "speechModel")).toBeNull();
      }
    });
  });

  describe("contactHints", () => {
    it("lists full names, then first names, then the 'call' variants", () => {
      expect(
        contactHints([{ name: "Mike Anderson" }, { name: "Sarah Chen" }])
      ).toEqual([
        "Mike Anderson",
        "Sarah Chen",
        "Mike",
        "Sarah",
        "call Mike Anderson",
        "call Sarah Chen",
        "call Mike",
        "call Sarah",
      ]);
    });

    it("drops duplicates: a one-word name and shared first names appear once", () => {
      expect(
        contactHints([
          { name: "Sanjeev" },
          { name: "Mike Anderson" },
          { name: "Mike Brown" },
        ])
      ).toEqual([
        "Sanjeev",
        "Mike Anderson",
        "Mike Brown",
        "Mike",
        "call Sanjeev",
        "call Mike Anderson",
        "call Mike Brown",
        "call Mike",
      ]);
    });

    it("drops commas and collapses whitespace before deriving the first name", () => {
      expect(contactHints([{ name: "  Anderson,   Mike " }])).toEqual([
        "Anderson Mike",
        "Anderson",
        "call Anderson Mike",
        "call Anderson",
      ]);
    });

    it("skips empty names and caps each phrase at 100 characters", () => {
      const long = "A".repeat(150);
      const hints = contactHints([
        { name: "" },
        { name: "   " },
        { name: long },
      ]);
      expect(hints).toEqual(["A".repeat(100), `call ${"A".repeat(95)}`]);
      for (const hint of hints) expect(hint.length).toBeLessThanOrEqual(100);
    });

    it("caps the list at 500 phrases, keeping full names ahead of variants", () => {
      const contacts = Array.from({ length: 300 }, (_, i) => ({
        name: `First${i} Last${i}`,
      }));
      const hints = contactHints(contacts);
      expect(hints).toHaveLength(500);
      expect(hints.slice(0, 300)).toEqual(contacts.map((c) => c.name));
      expect(hints[300]).toBe("First0");
    });
  });

  describe("escaping of untrusted contact names", () => {
    /** Parse the document so assertions see decoded text and attribute values. */
    function parse(xml: string): Document {
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      expect(doc.getElementsByTagName("parsererror").length).toBe(0);
      return doc;
    }
    const sayText = (doc: Document) =>
      doc.getElementsByTagName("Say")[0]?.textContent ?? "";
    const gatherAttr = (doc: Document, name: string) =>
      doc.getElementsByTagName("Gather")[0]?.getAttribute(name);

    it("escapes the name in the Say text of the confirm prompt", () => {
      const xml = confirmPrompt({
        settings: SETTINGS,
        actionUrl: ACTION,
        contactName: UNSAFE_NAME,
      });
      expect(xml).not.toContain(UNSAFE_NAME);
      expect(xml).toContain(">&lt;a&gt;&amp;");
      expect(sayText(parse(xml))).toBe(
        `${UNSAFE_NAME}. Press 1 or say yes to call, or 2 to try again.`
      );
    });

    it("escapes the name in the hints attribute and Say text of the gather prompt", () => {
      const xml = gatherPrompt({
        settings: SETTINGS,
        actionUrl: ACTION,
        hints: [UNSAFE_NAME, "Sarah Chen"],
        heard: UNSAFE_NAME,
      });
      expect(xml).not.toContain(UNSAFE_NAME);
      expect(attribute(xml, "hints")).toBe("&lt;a>&amp;&quot;Mike, Sarah Chen");
      const doc = parse(xml);
      expect(gatherAttr(doc, "hints")).toBe(`${UNSAFE_NAME}, Sarah Chen`);
      expect(gatherAttr(doc, "action")).toBe(ACTION);
      expect(sayText(doc).startsWith(`I heard ${UNSAFE_NAME},`)).toBe(true);
    });

    it("escapes the names in the disambiguation prompt", () => {
      const xml = disambiguationPrompt({
        settings: SETTINGS,
        actionUrl: ACTION,
        candidates: [{ name: UNSAFE_NAME }],
      });
      expect(xml).not.toContain(UNSAFE_NAME);
      expect(sayText(parse(xml))).toContain(`Press 1 for ${UNSAFE_NAME}.`);
    });

    it("escapes the caller's first name in the greeting", () => {
      const xml = gatherPrompt({
        settings: SETTINGS,
        actionUrl: ACTION,
        hints: [],
        callerFirstName: UNSAFE_NAME,
      });
      expect(xml).not.toContain(UNSAFE_NAME);
      expect(sayText(parse(xml))).toBe(
        `Hi ${UNSAFE_NAME}. Who would you like to call?`
      );
    });

    it("escapes the contact name in the post-dial outcome", () => {
      const xml = postDialOutcome("busy", {
        settings: SETTINGS,
        contactName: UNSAFE_NAME,
      });
      expect(xml).not.toContain(UNSAFE_NAME);
      expect(sayText(parse(xml))).toBe(
        `${UNSAFE_NAME} is busy right now. Try again later. Bye for now.`
      );
    });

    it("drops commas from hint names so one name is one hint", () => {
      const xml = gatherPrompt({
        settings: SETTINGS,
        actionUrl: ACTION,
        hints: ["Anderson, Mike"],
      });
      expect(attribute(xml, "hints")).toBe("Anderson Mike");
    });
  });
});
