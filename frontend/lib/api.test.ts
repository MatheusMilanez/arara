import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, checkHealth, listDatasets, search } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response> | Response,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(impl(String(input), init)),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("search", () => {
    it("monta a URL com os parâmetros informados e devolve o corpo tipado", async () => {
      const body = { ok: true, data: [], total: 0, limit: 20, offset: 0 };
      const fetchMock = stubFetch(() => jsonResponse(body));

      const result = await search({ q: "rondonia", limit: 20, offset: 0, dataset: "abc" });

      expect(result).toEqual(body);
      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain("/api/v1/search");
      expect(url).toContain("q=rondonia");
      expect(url).toContain("limit=20");
      expect(url).toContain("dataset=abc");
    });

    it("omite parâmetros opcionais não informados", async () => {
      const fetchMock = stubFetch(() =>
        jsonResponse({ ok: true, data: [], total: 0, limit: 20, offset: 0 }),
      );

      await search({ q: "rondonia" });

      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).not.toContain("limit=");
      expect(url).not.toContain("dataset=");
    });

    it("lança ApiError com status quando a API responde com erro", async () => {
      stubFetch(() => jsonResponse({ ok: false, error: "Invalid query parameters" }, 400));

      await expect(search({ q: "" })).rejects.toThrow(ApiError);
      await expect(search({ q: "" })).rejects.toMatchObject({ status: 400 });
    });

    it("lança ApiError sem status quando a rede falha", async () => {
      stubFetch(() => {
        throw new Error("network down");
      });

      await expect(search({ q: "x" })).rejects.toMatchObject({ status: undefined });
    });

    it("estoura o timeout e lança ApiError sem status", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const promise = search({ q: "x" });
      const assertion = expect(promise).rejects.toMatchObject({ status: undefined });
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    });
  });

  describe("listDatasets", () => {
    it("devolve a lista de datasets", async () => {
      const body = { ok: true, data: [{ id: "1", source: "ibge-municipios" }] };
      stubFetch(() => jsonResponse(body));

      const result = await listDatasets();
      expect(result).toEqual(body);
    });
  });

  describe("checkHealth", () => {
    it("devolve o status dos serviços", async () => {
      const body = {
        status: "ok",
        timestamp: "2026-08-21T00:00:00.000Z",
        services: { database: { status: "ok", latency_ms: 1 }, redis: { status: "ok", latency_ms: 1 } },
      };
      stubFetch(() => jsonResponse(body));

      const result = await checkHealth();
      expect(result).toEqual(body);
    });

    it("lança ApiError quando o backend está fora do ar (503)", async () => {
      stubFetch(() => jsonResponse({ status: "error" }, 503));

      await expect(checkHealth()).rejects.toMatchObject({ status: 503 });
    });
  });
});
