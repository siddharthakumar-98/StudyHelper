import { describe, expect, it } from "vitest";
import {
  bankHref,
  countLabel,
  defaultStatus,
  isStaleError,
  parseBankSearch,
  regenerateMessage,
  statusChips,
  STATUS_LABEL,
} from "@/components/bank/bankView";

const TOPIC = "0b9d9a52-2f55-4c4e-9a2e-2d1c5f0a7b11";

describe("statusChips", () => {
  it("gives a student Active and Flagged only", () => {
    expect(statusChips(false).map((c) => c.label)).toEqual(["Active", "Flagged"]);
  });

  it("gives an admin the review statuses too, drafts as 'Being checked'", () => {
    expect(statusChips(true).map((c) => c.label)).toEqual([
      "Needs review",
      "Active",
      "Flagged",
      "Retired",
      "Being checked",
    ]);
    expect(STATUS_LABEL.draft).toBe("Being checked");
  });
});

describe("parseBankSearch", () => {
  it("keeps valid values", () => {
    expect(
      parseBankSearch(
        { status: "flagged", type: "saq", difficulty: "hard", topic: TOPIC },
        true,
      ),
    ).toEqual({ status: "flagged", type: "saq", difficulty: "hard", topicId: TOPIC });
  });

  it("ignores junk, repeated params and a topic that is not an id", () => {
    expect(
      parseBankSearch({ status: ["x", "y"], type: "essay", difficulty: "?", topic: "nope" }, true),
    ).toEqual({});
  });

  it("does not let a student ask for a status they cannot see", () => {
    expect(parseBankSearch({ status: "needs_review" }, false)).toEqual({});
    expect(parseBankSearch({ status: "retired" }, false)).toEqual({});
    expect(parseBankSearch({ status: "flagged" }, false)).toEqual({ status: "flagged" });
  });
});

describe("defaultStatus", () => {
  it("opens an admin on Needs review while the queue has questions", () => {
    expect(defaultStatus(true, 3)).toBe("needs_review");
  });
  it("falls back to Active for an admin with an empty queue", () => {
    expect(defaultStatus(true, 0)).toBe("active");
  });
  it("is always Active for a student", () => {
    expect(defaultStatus(false, 9)).toBe("active");
  });
});

describe("bankHref", () => {
  it("builds a query with only the chosen filters", () => {
    expect(bankHref({ status: "active" })).toBe("/bank?status=active");
    expect(bankHref({ status: "active", type: "mcq", difficulty: "easy", topicId: TOPIC })).toBe(
      `/bank?status=active&type=mcq&difficulty=easy&topic=${TOPIC}`,
    );
    expect(bankHref({})).toBe("/bank");
  });
});

describe("countLabel", () => {
  it("pluralises", () => {
    expect(countLabel(0)).toBe("0 questions");
    expect(countLabel(1)).toBe("1 question");
    expect(countLabel(42)).toBe("42 questions");
  });
});

describe("isStaleError", () => {
  it("recognises both server wordings for a changed question", () => {
    expect(
      isStaleError(
        "This question was changed since you opened it. Reload the page to see the latest version, then try again.",
      ),
    ).toBe(true);
    expect(isStaleError("This question was changed by someone else. Reload and try again.")).toBe(true);
    expect(isStaleError("Write the question text")).toBe(false);
  });
});

describe("regenerateMessage", () => {
  it("explains a duplicate that was retired", () => {
    expect(regenerateMessage("retired")).toBe(
      "The new version repeated an existing question, so it was retired.",
    );
  });
  it("says when the new version passed or needs a look", () => {
    expect(regenerateMessage("active")).toMatch(/new version.*checked/i);
    expect(regenerateMessage("needs_review")).toMatch(/needs your review/i);
  });
  it("covers a draft that is still being checked", () => {
    expect(regenerateMessage("draft")).toMatch(/still being checked/i);
  });
});
