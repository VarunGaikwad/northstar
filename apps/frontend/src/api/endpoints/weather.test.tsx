// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiPublicGet } from "../client";
import { useWeather } from "./weather";

vi.mock("../client", () => ({ apiPublicGet: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let client: QueryClient;
let root: Root;

function Probe() {
  useWeather();
  return null;
}

async function mount() {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  });
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement("div"));
  vi.mocked(apiPublicGet).mockResolvedValue({});
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("requests weather with browser coordinates when available", async () => {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (success: PositionCallback) => {
        success({ coords: { latitude: 28.61, longitude: 77.21 } } as GeolocationPosition);
      },
    },
  });

  await mount();

  expect(apiPublicGet).toHaveBeenCalledExactlyOnceWith("/weather?lat=28.61&lon=77.21");
});

it("requests backend IP-based weather when client geolocation fails", async () => {
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("IP lookup blocked")));

  await mount();

  expect(apiPublicGet).toHaveBeenCalledExactlyOnceWith("/weather");
});

it("does not wait indefinitely for the browser permission prompt", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: vi.fn() } });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("IP lookup blocked")));

  await mount();
  expect(apiPublicGet).not.toHaveBeenCalled();

  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

  expect(apiPublicGet).toHaveBeenCalledExactlyOnceWith("/weather");
});
