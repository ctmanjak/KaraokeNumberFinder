import { describe, expect, it } from "vitest";
import { parseLimitedJsonBody, requireJsonContentType } from "./body";

describe("actual JSON request byte limits", () => {
  it("accepts the exact byte boundary and rejects one byte more", async () => {
    const exact = new Request("https://knf.example/test", {
      method: "PATCH",
      body: `"${"a".repeat(8)}"`
    });
    await expect(parseLimitedJsonBody(exact, 10)).resolves.toBe("a".repeat(8));

    const over = new Request("https://knf.example/test", {
      method: "PATCH",
      body: `"${"a".repeat(9)}"`
    });
    await expect(parseLimitedJsonBody(over, 10)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413
    });
  });

  it("counts UTF-8 bytes rather than JavaScript characters", async () => {
    const multibyte = new Request("https://knf.example/test", {
      method: "PATCH",
      body: JSON.stringify("가")
    });
    await expect(parseLimitedJsonBody(multibyte, 4)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE"
    });
  });

  it("uses actual 524288/524289 bytes even when Content-Length is understated", async () => {
    const limit = 524_288;
    const exact = new Request("https://knf.example/test", {
      method: "PATCH",
      headers: { "content-length": "1" },
      body: `"${"a".repeat(limit - 2)}"`
    });
    await expect(parseLimitedJsonBody(exact, limit)).resolves.toBe(
      "a".repeat(limit - 2)
    );

    const over = new Request("https://knf.example/test", {
      method: "PATCH",
      headers: { "content-length": "1" },
      body: `"${"a".repeat(limit - 1)}"`
    });
    await expect(parseLimitedJsonBody(over, limit)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413
    });
  });

  it("enforces the authoritative limit across chunked stream boundaries", async () => {
    const encoder = new TextEncoder();
    const request = new Request("https://knf.example/test", {
      method: "PATCH",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`"${"a".repeat(6)}`));
          controller.enqueue(encoder.encode(`${"b".repeat(5)}"`));
          controller.close();
        }
      }),
      duplex: "half"
    } as RequestInit);

    await expect(parseLimitedJsonBody(request, 12)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE"
    });
  });

  it("rejects non-JSON media types separately from CSRF", () => {
    expect(() =>
      requireJsonContentType(
        new Request("https://knf.example/test", {
          headers: { "content-type": "text/plain" }
        })
      )
    ).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 })
    );
  });

  it("accepts only balanced optional quotes around the UTF-8 charset", () => {
    for (const charset of ["utf-8", '"utf-8"']) {
      expect(() =>
        requireJsonContentType(
          new Request("https://knf.example/test", {
            headers: {
              "content-type": `application/json; charset=${charset}`
            }
          })
        )
      ).not.toThrow();
    }
    for (const charset of ['"utf-8', 'utf-8"']) {
      expect(() =>
        requireJsonContentType(
          new Request("https://knf.example/test", {
            headers: {
              "content-type": `application/json; charset=${charset}`
            }
          })
        )
      ).toThrowError(
        expect.objectContaining({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 })
      );
    }
  });
});
