import { describe, expect, it } from "vitest";
import { appDisplayName, dirDisplayName } from "./app-names";
import { ruleText } from "./rule-text";

describe("ruleText", () => {
  it("turns core rule strings into plain words", () => {
    expect(ruleText("process_name chrome.exe")).toBe("应用 chrome.exe");
    expect(ruleText("process_name=[chrome.exe] => route(proxy)")).toBe("应用 chrome.exe");
    expect(ruleText("rule_set geosite-cn")).toBe("国内网站");
    expect(ruleText("rule_set=[geosite-cn,geoip-cn] => route(direct)")).toBe("国内网站、国内 IP");
    expect(ruleText("process_path_regex=[(?i)^C:\\\\X\\\\] => route(proxy)")).toBe("整个目录的应用");
    expect(ruleText("final")).toBe("默认规则");
  });
  it("keeps unknown text and empty input", () => {
    expect(ruleText("something odd")).toBe("something odd");
    expect(ruleText("")).toBe("");
    expect(ruleText(undefined)).toBe("");
  });
});

describe("app names", () => {
  it("prefers curated names, then exe description, then file name", () => {
    expect(appDisplayName("C:\\Program Files\\Google\\chrome.exe")).toBe("Chrome 浏览器");
    expect(appDisplayName("foo.exe", [{ name: "foo.exe", path: "C:\\foo.exe", desc: "Foo Studio", count: 1 }])).toBe(
      "Foo Studio",
    );
    expect(appDisplayName("bar.exe")).toBe("bar");
  });
  it("names emulator folders", () => {
    expect(dirDisplayName("C:\\Program Files\\ldplayer9box\\")).toBe("雷电模拟器");
    expect(dirDisplayName("D:\\Games\\Tool\\")).toBe("Tool");
  });
});
