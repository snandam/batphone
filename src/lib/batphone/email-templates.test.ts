import { describe, expect, it } from "vitest";

import {
  contactSpeakerLabel,
  escapeHtml,
  renderMetadataOnlyEmail,
  renderTranscriptEmail,
  type MetadataOnlyEmailInput,
  type TranscriptEmailInput,
} from "./email-templates";

import type { StoredTranscript } from "./state";

const transcript: StoredTranscript = {
  model: "nova-3",
  requestId: "req-1",
  channelConfidence: [0.98, 0.97],
  identicalChannels: false,
  utterances: [
    {
      channel: 0,
      start: 0,
      end: 1.2,
      text: "Hi Alice, it's Bob.",
      confidence: 0.99,
    },
    {
      channel: 1,
      start: 1.4,
      end: 2.9,
      text: "Hey Bob, what's up?",
      confidence: 0.98,
    },
    {
      channel: 0,
      start: 3.1,
      end: 5,
      text: "Calling about the invoice.",
      confidence: 0.97,
    },
  ],
};

const base = {
  callerName: "Bob Builder",
  contactName: "Alice Smith",
  destinationNumber: "+14155552671",
  startedAt: new Date("2026-09-11T22:42:00Z"),
  durationSec: 61,
  outcome: "completed",
  timeZone: "America/Los_Angeles",
  callPageUrl: "https://batphone.example.com/calls/abc-123",
};

const fullInput: TranscriptEmailInput = { ...base, transcript };

describe("renderTranscriptEmail", () => {
  it("renders every header field, every labelled utterance, and the link in both bodies", () => {
    const { subject, text, html } = renderTranscriptEmail(fullInput);

    expect(subject).toBe("Call with Alice Smith, 1:01, Sep 11, 2026, 3:42 PM");

    expect(text).toContain("Call Transcript");
    expect(text).toContain("Caller: Bob Builder");
    expect(text).toContain("Destination: Alice Smith");
    expect(text).toContain("Phone Number: +1 415 555 2671");
    expect(text).toContain("Call Start Time: Sep 11, 2026, 3:42 PM");
    expect(text).toContain("Call Duration: 1:01");
    expect(text).toContain("Outcome: completed");
    expect(text).toContain("You: Hi Alice, it's Bob.");
    expect(text).toContain("Alice Smith: Hey Bob, what's up?");
    expect(text).toContain("You: Calling about the invoice.");
    expect(text).toContain(base.callPageUrl);
    expect(text.indexOf("Call Duration")).toBeLessThan(
      text.indexOf("You: Hi Alice")
    );
    expect(text.indexOf("You: Calling about")).toBeLessThan(
      text.indexOf(base.callPageUrl)
    );

    expect(html).toContain("Bob Builder");
    expect(html).toContain("Alice Smith");
    expect(html).toContain("+1 415 555 2671");
    expect(html).toContain("Sep 11, 2026, 3:42 PM");
    expect(html).toContain("1:01");
    expect(html).toContain("completed");
    expect(html).toContain("Hi Alice, it&#39;s Bob.");
    expect(html).toContain("Hey Bob, what&#39;s up?");
    expect(html).toContain("Calling about the invoice.");
    expect(html).toContain(`href="${base.callPageUrl}"`);
    expect(html).toMatch(/<p[^>]*><strong>You:<\/strong> Hi Alice/);
    expect(html).toMatch(/<p[^>]*><strong>Alice Smith:<\/strong> Hey Bob/);
    expect(html).not.toContain("<table");
  });

  it("escapes markup inside utterances and names", () => {
    const hostile: TranscriptEmailInput = {
      ...fullInput,
      contactName: 'Eve <b>"Bold"</b>',
      transcript: {
        ...transcript,
        utterances: [
          {
            channel: 0,
            start: 0,
            end: 1,
            text: "<script>alert(1)</script>",
            confidence: 1,
          },
          {
            channel: 1,
            start: 1,
            end: 2,
            text: '<a href="x">click</a>',
            confidence: 1,
          },
        ],
      },
    };
    const { html, subject } = renderTranscriptEmail(hostile);

    expect(html).not.toContain("<script>");
    expect(html).not.toContain('<a href="x">');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;a href=&quot;x&quot;&gt;click&lt;/a&gt;");
    expect(html).toContain("Eve &lt;b&gt;&quot;Bold&quot;&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(subject).toContain('Eve <b>"Bold"</b>');
  });

  it("escapes the call page URL in the href", () => {
    const { html } = renderTranscriptEmail({
      ...fullInput,
      callPageUrl: 'https://x.example/"><script>',
    });
    expect(html).not.toContain('"><script>');
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("renders unlabelled paragraphs with a note when the channels are identical", () => {
    const { text, html } = renderTranscriptEmail({
      ...fullInput,
      transcript: { ...transcript, identicalChannels: true },
    });
    const note = "Speakers could not be separated on this recording";
    expect(text).toContain(note);
    expect(html).toContain(note);
    expect(text).toContain("Hi Alice, it's Bob.");
    expect(text).not.toContain("You: ");
    expect(text).not.toContain("Alice Smith: Hey");
    expect(html).not.toContain("<strong>You:</strong>");
  });

  it("says no speech was detected when the transcript is empty", () => {
    const { text, html } = renderTranscriptEmail({
      ...fullInput,
      transcript: { ...transcript, utterances: [] },
    });
    expect(text).toContain("No speech was detected.");
    expect(html).toContain("No speech was detected.");
  });

  it("renders an unknown duration as a dash in the header and subject", () => {
    const { subject, text } = renderTranscriptEmail({
      ...fullInput,
      durationSec: null,
    });
    expect(subject).toBe("Call with Alice Smith, -, Sep 11, 2026, 3:42 PM");
    expect(text).toContain("Call Duration: -");
  });
});

describe("renderMetadataOnlyEmail", () => {
  const metaInput: MetadataOnlyEmailInput = {
    ...base,
    reason: "transcription_failed",
  };

  it("names the transcription failure, links to the call page, and omits the transcript", () => {
    const { subject, text, html } = renderMetadataOnlyEmail(metaInput);

    expect(subject).toBe("Call with Alice Smith, 1:01, Sep 11, 2026, 3:42 PM");
    expect(text).toContain("Caller: Bob Builder");
    expect(text).toContain("Call Duration: 1:01");
    expect(text).toMatch(/transcription .*failed/i);
    expect(text).toContain("retry");
    expect(text).toContain(base.callPageUrl);
    expect(html).toMatch(/transcription .*failed/i);
    expect(html).toContain(`href="${base.callPageUrl}"`);

    expect(text).not.toContain("You:");
    expect(text).not.toContain("Call Transcript");
    expect(html).not.toContain("<strong>You:</strong>");
  });

  it("explains a missing recording without offering a retry", () => {
    const { text, html } = renderMetadataOnlyEmail({
      ...metaInput,
      reason: "no_recording",
    });
    expect(text).toMatch(/no recording/i);
    expect(html).toMatch(/no recording/i);
    expect(text).not.toMatch(/retry/i);
    expect(text).toContain(base.callPageUrl);
  });

  it("escapes interpolated values", () => {
    const { html } = renderMetadataOnlyEmail({
      ...metaInput,
      callerName: "<img src=x>",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x&gt;");
  });
});

describe("automated answer transcripts", () => {
  it("labels the far side Automated system instead of the contact name when a machine answered", () => {
    const { text, html } = renderTranscriptEmail({
      ...fullInput,
      outcome: "Automated answer",
      answeredBy: "machine_end_beep",
    });
    expect(text).toContain("Outcome: Automated answer");
    expect(text).toContain("Automated system: Hey Bob, what's up?");
    expect(text).not.toContain("Alice Smith: Hey Bob");
    expect(text).toContain("You: Hi Alice, it's Bob.");
    expect(text).toContain("Destination: Alice Smith");
    expect(html).toMatch(/<p[^>]*><strong>Automated system:<\/strong> Hey Bob/);
  });

  it("keeps the contact name when a human or nobody answered", () => {
    for (const answeredBy of ["human", "unknown", null, undefined]) {
      const { text } = renderTranscriptEmail({ ...fullInput, answeredBy });
      expect(text).toContain("Alice Smith: Hey Bob, what's up?");
    }
  });

  it("contactSpeakerLabel is the shared rule", () => {
    expect(contactSpeakerLabel("Alice Smith", "machine_start")).toBe(
      "Automated system"
    );
    expect(contactSpeakerLabel("Alice Smith", "human")).toBe("Alice Smith");
    expect(contactSpeakerLabel("Alice Smith", null)).toBe("Alice Smith");
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });
});

describe("single-channel transcripts", () => {
  it("renders unlabelled paragraphs with the separation note when channels is 1", () => {
    const rendered = renderTranscriptEmail({
      ...base,
      transcript: { ...transcript, channels: 1 },
    });
    expect(rendered.text).toContain("Speakers could not be separated");
    expect(rendered.text).not.toContain("You:");
    expect(rendered.html).toContain("Speakers could not be separated");
  });
});
