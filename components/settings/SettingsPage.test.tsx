// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { DEFAULT_PROVIDER_STORAGE_KEY } from "@/lib/preferences/default-provider-storage";
import { SettingsPage } from "./SettingsPage";

const providers = [
  provider("provider-a", "Provider A", true, 1),
  provider("provider-b", "Provider B", false, 2)
];

describe("SettingsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses and updates the guest local default without a preference API call", async () => {
    seedLocalProvider("provider-b");
    const fetcher = installFetch({ auth: "guest" });
    renderSettings();

    const select = await screen.findByLabelText("제공사");
    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe("provider-b")
    );
    fireEvent.change(select, { target: { value: "provider-a" } });

    expect(readLocalProvider()).toBe("provider-a");
    expect(
      fetcher.mock.calls.some(
        ([input]) => input.toString() === "/api/user-preference"
      )
    ).toBe(false);
  });

  it("loads and updates the authenticated server preference", async () => {
    const fetcher = installFetch({ auth: "authenticated" });
    renderSettings();

    const select = await screen.findByLabelText("제공사");
    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe("provider-b")
    );
    fireEvent.change(select, { target: { value: "provider-a" } });

    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([input, init]) =>
            input.toString() === "/api/user-preference/default-provider" &&
            init?.method === "PUT"
        )
      ).toBe(true)
    );
    expect(
      await screen.findByText("계정의 기본 제공사로 저장됩니다.")
    ).toBeTruthy();
  });

  it("retries a provider-list failure independently", async () => {
    const fetcher = installFetch({ auth: "guest", providerFailures: 1 });
    renderSettings();

    fireEvent.click(
      await screen.findByRole("button", { name: "제공사 다시 시도" })
    );
    expect(await screen.findByLabelText("제공사")).toBeTruthy();
    expect(
      fetcher.mock.calls.filter(
        ([input]) => input.toString() === "/api/providers"
      )
    ).toHaveLength(2);
  });

  it("keeps providers usable while preference loading fails and retries only it", async () => {
    const fetcher = installFetch({
      auth: "authenticated",
      preferenceFailures: 1
    });
    renderSettings();

    const select = await screen.findByLabelText("제공사");
    expect((select as HTMLSelectElement).disabled).toBe(false);
    fireEvent.click(
      await screen.findByRole("button", { name: "설정 다시 시도" })
    );

    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe("provider-b")
    );
    expect(
      fetcher.mock.calls.filter(
        ([input]) => input.toString() === "/api/providers"
      )
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(
        ([input]) => input.toString() === "/api/user-preference"
      )
    ).toHaveLength(2);
  });

  it("keeps the guest fallback when an authenticated save finishes after expiration", async () => {
    const preferenceWrite = deferred<Response>();
    const fetcher = vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url = input.toString();
        if (url === "/api/auth/get-session") {
          return jsonResponse({ user: { id: "user-a" } });
        }
        if (url === "/api/providers") {
          return jsonResponse({ items: providers });
        }
        if (url === "/api/user-preference") {
          return jsonResponse(preference("provider-b"));
        }
        if (
          url === "/api/user-preference/default-provider" &&
          init?.method === "PUT"
        ) {
          return preferenceWrite.promise;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetcher);
    render(
      <AuthProvider>
        <SettingsPage />
        <ExpireControl />
      </AuthProvider>
    );

    const select = await screen.findByLabelText("제공사");
    await waitFor(() =>
      expect((select as HTMLSelectElement).value).toBe("provider-b")
    );
    fireEvent.change(select, { target: { value: "provider-a" } });
    expect(readLocalProvider()).toBe("provider-a");
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([input, init]) =>
            input.toString() === "/api/user-preference/default-provider" &&
            init?.method === "PUT"
        )
      ).toBe(true)
    );

    fireEvent.click(screen.getByRole("button", { name: "세션 만료 처리" }));
    preferenceWrite.resolve(jsonResponse(preference("provider-a")));
    await waitFor(() => expect(readLocalProvider()).toBe("provider-a"));
  });
});

function ExpireControl() {
  const auth = useAuth();
  return (
    <button type="button" onClick={auth.markExpired}>
      세션 만료 처리
    </button>
  );
}

function renderSettings() {
  return render(
    <AuthProvider>
      <SettingsPage />
    </AuthProvider>
  );
}

function installFetch(options: {
  auth: "guest" | "authenticated";
  providerFailures?: number;
  preferenceFailures?: number;
}) {
  let providerFailures = options.providerFailures ?? 0;
  let preferenceFailures = options.preferenceFailures ?? 0;
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      if (url === "/api/auth/get-session") {
        return jsonResponse(
          options.auth === "guest" ? null : { user: { id: "user-a" } }
        );
      }
      if (url === "/api/providers") {
        if (providerFailures > 0) {
          providerFailures -= 1;
          return jsonResponse({ error: {} }, 503);
        }
        return jsonResponse({ items: providers });
      }
      if (url === "/api/user-preference") {
        if (preferenceFailures > 0) {
          preferenceFailures -= 1;
          return jsonResponse({ error: {} }, 503);
        }
        return jsonResponse(preference("provider-b"));
      }
      if (
        url === "/api/user-preference/default-provider" &&
        init?.method === "PUT"
      ) {
        const body = JSON.parse(String(init.body)) as { provider_id: string };
        return jsonResponse(preference(body.provider_id));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function preference(providerId: string) {
  return {
    default_provider: providers.find(({ id }) => id === providerId) ?? null,
    source: "user"
  };
}

function provider(
  id: string,
  name: string,
  isDefault: boolean,
  displayOrder: number
) {
  return {
    id,
    name,
    country: "KR",
    is_active: true,
    display_order: displayOrder,
    is_default: isDefault,
    last_catalog_updated_at: null
  };
}

function seedLocalProvider(providerId: string): void {
  window.localStorage.setItem(
    DEFAULT_PROVIDER_STORAGE_KEY,
    JSON.stringify({ version: 1, provider_id: providerId })
  );
}

function readLocalProvider(): string | undefined {
  const raw = window.localStorage.getItem(DEFAULT_PROVIDER_STORAGE_KEY);
  return raw === null
    ? undefined
    : (JSON.parse(raw) as { provider_id: string }).provider_id;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
