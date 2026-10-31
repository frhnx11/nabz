import { describe, expect, it } from "vitest";
import { assertLocalNabzDatabase, parseDatabaseUrl } from "./local-guard";

describe("assertLocalNabzDatabase", () => {
  it("accepts local nabz databases", () => {
    expect(assertLocalNabzDatabase("postgres://nabz:pw@127.0.0.1:5432/nabz_dev").database).toBe("nabz_dev");
    expect(assertLocalNabzDatabase("postgresql://nabz:pw@localhost/nabz_test").port).toBe(5432);
    expect(assertLocalNabzDatabase("postgres://nabz:pw@[::1]:5433/nabz_dev").port).toBe(5433);
  });

  it.each([
    ["a hosted database", "postgres://nabz:pw@ep-cool-sun.ap-southeast-1.aws.neon.tech/nabz_dev"],
    ["another machine", "postgres://nabz:pw@192.168.1.20/nabz_dev"],
    ["the postgres database", "postgres://postgres:pw@127.0.0.1/postgres"],
    ["an unknown database", "postgres://nabz:pw@127.0.0.1/production"],
  ])("refuses %s", (_, url) => {
    expect(() => assertLocalNabzDatabase(url)).toThrow(/Refusing/);
  });

  it("never echoes the password in errors", () => {
    expect(() => assertLocalNabzDatabase("postgres://nabz:hunter2secret@db.example.com/nabz_dev")).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("hunter2secret") }),
    );
  });

  it("rejects non-postgres URLs", () => {
    expect(() => parseDatabaseUrl("mysql://x@localhost/nabz_dev")).toThrow(/postgres/);
    expect(() => parseDatabaseUrl("not a url")).toThrow(/valid URL/);
  });
});
