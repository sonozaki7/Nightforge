import { describe, it, expect } from "vitest";
import {
  createBlastRadiusClassifier,
  getDefaultRules,
} from "../src/tools/blast-radius.js";

describe("BlastRadiusClassifier", () => {
  const classifier = createBlastRadiusClassifier();

  describe("zero blast radius (fully autonomous)", () => {
    it("classifies git operations as zero", () => {
      expect(classifier.classify("git", "commit")).toBe("zero");
      expect(classifier.classify("git", "merge")).toBe("zero");
      expect(classifier.classify("git", "checkout")).toBe("zero");
    });

    it("classifies file operations as zero", () => {
      expect(classifier.classify("file", "read")).toBe("zero");
      expect(classifier.classify("file", "write")).toBe("zero");
    });

    it("classifies test/lint/build as zero", () => {
      expect(classifier.classify("test", "run")).toBe("zero");
      expect(classifier.classify("lint", "check")).toBe("zero");
      expect(classifier.classify("build", "compile")).toBe("zero");
    });

    it("classifies read-only service calls as zero", () => {
      expect(classifier.classify("github", "read")).toBe("zero");
      expect(classifier.classify("stripe", "list")).toBe("zero");
      expect(classifier.classify("cloudflare", "read")).toBe("zero");
    });
  });

  describe("low blast radius (auto + notify)", () => {
    it("classifies staging deploys as low", () => {
      expect(classifier.classify("deploy", "staging")).toBe("low");
    });

    it("classifies crawl/search as low", () => {
      expect(classifier.classify("crawl", "fetch_page")).toBe("low");
      expect(classifier.classify("search", "query")).toBe("low");
    });

    it("classifies github branch/issue creation as low", () => {
      expect(classifier.classify("github", "create_branch")).toBe("low");
      expect(classifier.classify("github", "create_issue")).toBe("low");
    });
  });

  describe("high blast radius (Telegram approve)", () => {
    it("classifies financial operations as high", () => {
      expect(classifier.classify("stripe", "charge")).toBe("high");
      expect(classifier.classify("stripe", "create_payment")).toBe("high");
    });

    it("classifies DNS changes as high", () => {
      expect(classifier.classify("cloudflare", "update_dns")).toBe("high");
    });

    it("classifies email sending as high", () => {
      expect(classifier.classify("email", "send")).toBe("high");
    });

    it("classifies production deploys as high", () => {
      expect(classifier.classify("deploy", "production")).toBe("high");
    });

    it("classifies auth modifications as high", () => {
      expect(classifier.classify("auth", "modify")).toBe("high");
    });

    it("classifies billing wildcard as high", () => {
      expect(classifier.classify("billing", "update_plan")).toBe("high");
      expect(classifier.classify("billing", "cancel_subscription")).toBe("high");
    });
  });

  describe("irreversible blast radius (forbidden)", () => {
    it("classifies refunds as irreversible", () => {
      expect(classifier.classify("stripe", "refund")).toBe("irreversible");
    });

    it("classifies customer deletion as irreversible", () => {
      expect(classifier.classify("stripe", "delete_customer")).toBe("irreversible");
    });

    it("classifies database drops as irreversible", () => {
      expect(classifier.classify("database", "drop")).toBe("irreversible");
    });

    it("classifies bulk email as irreversible", () => {
      expect(classifier.classify("email", "send_bulk")).toBe("irreversible");
    });

    it("classifies DNS zone deletion as irreversible", () => {
      expect(classifier.classify("dns", "delete_zone")).toBe("irreversible");
    });
  });

  describe("unknown actions default to high", () => {
    it("classifies unknown service/action as high", () => {
      expect(classifier.classify("unknown_service", "mystery_action")).toBe("high");
    });
  });

  describe("permission tier mapping", () => {
    it("maps zero and low to auto", () => {
      expect(classifier.toPermissionTier("zero")).toBe("auto");
      expect(classifier.toPermissionTier("low")).toBe("auto");
    });

    it("maps high to approve", () => {
      expect(classifier.toPermissionTier("high")).toBe("approve");
    });

    it("maps irreversible to forbidden", () => {
      expect(classifier.toPermissionTier("irreversible")).toBe("forbidden");
    });
  });

  describe("autonomy check", () => {
    it("zero and low are autonomous", () => {
      expect(classifier.isAutonomous("zero")).toBe(true);
      expect(classifier.isAutonomous("low")).toBe(true);
    });

    it("high and irreversible are NOT autonomous", () => {
      expect(classifier.isAutonomous("high")).toBe(false);
      expect(classifier.isAutonomous("irreversible")).toBe(false);
    });
  });

  describe("custom rules", () => {
    it("custom rules take priority over defaults", () => {
      const custom = createBlastRadiusClassifier([
        { pattern: "deploy:production", radius: "zero", reason: "YOLO mode" },
      ]);

      expect(custom.classify("deploy", "production")).toBe("zero");
    });
  });

  describe("getDefaultRules", () => {
    it("returns a non-empty array of rules", () => {
      const rules = getDefaultRules();
      expect(rules.length).toBeGreaterThan(10);
      expect(rules[0]).toHaveProperty("pattern");
      expect(rules[0]).toHaveProperty("radius");
      expect(rules[0]).toHaveProperty("reason");
    });
  });
});
