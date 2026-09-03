import { describe, expect, it } from "vitest";
import { parseModelAnswer } from "../src/providers/parse";

describe("parseModelAnswer", () => {
  it("parses a clean JSON object", () => {
    const a = parseModelAnswer('{"final_answer":"30 minutes","superseded_rules":["15"],"evidence":["x"]}');
    expect(a?.final_answer).toBe("30 minutes");
    expect(a?.superseded_rules).toEqual(["15"]);
  });

  it("extracts JSON from a fenced code block with prose", () => {
    const raw = "Sure!\n```json\n{\n  \"final_answer\": \"workload identity\",\n  \"superseded_rules\": [],\n  \"evidence\": []\n}\n```\nHope that helps.";
    const a = parseModelAnswer(raw);
    expect(a?.final_answer).toBe("workload identity");
  });

  it("ignores braces inside strings", () => {
    const a = parseModelAnswer('{"final_answer":"use {curly} braces","superseded_rules":[],"evidence":[]}');
    expect(a?.final_answer).toBe("use {curly} braces");
  });

  it("returns null when no JSON object is present", () => {
    expect(parseModelAnswer("no json here")).toBeNull();
  });
});
