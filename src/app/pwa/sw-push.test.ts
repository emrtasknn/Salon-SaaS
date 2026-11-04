import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// WP-09 QA: executes public/sw.js in a sandbox with a fake ServiceWorkerGlobalScope and
// drives the push / notificationclick handlers. The payload is display-only; every push
// must call showNotification (iOS revokes subscriptions after silent pushes) and a click
// may only open same-origin allowlisted paths.

const ORIGIN = "https://salon.example.com";
const swSource = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8").replace(/^﻿/, "");

type Listener = (event: unknown) => void;
type WindowClientFake = { url: string; focus: ReturnType<typeof vi.fn>; navigate?: ReturnType<typeof vi.fn> };

function loadServiceWorker(windows: WindowClientFake[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(null);
  const matchAll = vi.fn().mockResolvedValue(windows);
  const self = {
    location: { origin: ORIGIN },
    registration: { showNotification },
    clients: { matchAll, openWindow, claim: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };
  runInNewContext(swSource, { self, URL, Response, Promise, caches: {}, fetch: vi.fn() });
  return { listeners, showNotification, openWindow, matchAll };
}

async function dispatch(listener: Listener | undefined, event: Record<string, unknown>) {
  if (!listener) throw new Error("listener not registered");
  let pending: Promise<unknown> | undefined;
  listener({ ...event, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  expect(pending, "handler must call event.waitUntil").toBeDefined();
  await pending;
}

function pushEvent(data: unknown) {
  if (data === undefined) return { data: null };
  return {
    data: {
      json: () => {
        if (typeof data === "string") return JSON.parse(data);
        return data;
      },
    },
  };
}

describe("public/sw.js push handler (WP-09)", () => {
  it("shows the payload title/body/tag with an allowlisted url", async () => {
    const sw = loadServiceWorker();
    await dispatch(sw.listeners.get("push"), pushEvent({
      v: 1, type: "APPOINTMENT_CREATED", title: "Yeni randevu talebi", body: "Saç kesimi — 05.11.2026 13:00", url: "/admin/calendar", tag: "appt-1",
    }));
    expect(sw.showNotification).toHaveBeenCalledOnce();
    const [title, options] = sw.showNotification.mock.calls[0];
    expect(title).toBe("Yeni randevu talebi");
    expect(options).toMatchObject({ body: "Saç kesimi — 05.11.2026 13:00", tag: "appt-1", data: { url: "/admin/calendar" } });
  });

  it.each([
    ["no data", undefined],
    ["invalid JSON", "{not json"],
    ["non-object JSON", "42"],
    ["empty title", { title: "  ", url: "/staff/appointments" }],
  ])("always calls showNotification with a generic fallback for %s", async (_label, data) => {
    const sw = loadServiceWorker();
    await dispatch(sw.listeners.get("push"), pushEvent(data));
    expect(sw.showNotification).toHaveBeenCalledOnce();
    expect(sw.showNotification.mock.calls[0][0]).toBe("Yeni bildirim");
  });

  it.each([
    ["https://evil.example.com/admin/calendar", "/"],
    ["//evil.example.com/admin/calendar", "/"],
    ["javascript:alert(1)", "/"],
    ["/admin/settings", "/"],
    ["/staff/appointments?x=1", "/staff/appointments"],
    [42, "/"],
  ])("sanitizes payload url %s to %s", async (url, expected) => {
    const sw = loadServiceWorker();
    await dispatch(sw.listeners.get("push"), pushEvent({ title: "t", url }));
    expect(sw.showNotification.mock.calls[0][1].data.url).toBe(expected);
  });
});

describe("public/sw.js notificationclick handler (WP-09)", () => {
  function clickEvent(url: unknown) {
    return { notification: { close: vi.fn(), data: { url } } };
  }

  it("opens a new window on an allowlisted path when no client exists", async () => {
    const sw = loadServiceWorker();
    const event = clickEvent("/staff/appointments");
    await dispatch(sw.listeners.get("notificationclick"), event);
    expect(event.notification.close).toHaveBeenCalledOnce();
    expect(sw.openWindow).toHaveBeenCalledWith("/staff/appointments");
  });

  it.each(["https://evil.example.com/x", "//evil.example.com", "/admin/settings", null])("falls back to / for %s", async (url) => {
    const sw = loadServiceWorker();
    await dispatch(sw.listeners.get("notificationclick"), clickEvent(url));
    expect(sw.openWindow).toHaveBeenCalledWith("/");
  });

  it("focuses and navigates an existing same-origin window instead of opening one", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const client: WindowClientFake = { url: `${ORIGIN}/staff`, focus: vi.fn(), navigate };
    client.focus.mockResolvedValue(client);
    const foreign: WindowClientFake = { url: "https://other.example.com/", focus: vi.fn() };
    const sw = loadServiceWorker([foreign, client]);
    await dispatch(sw.listeners.get("notificationclick"), clickEvent("/admin/calendar"));
    expect(foreign.focus).not.toHaveBeenCalled();
    expect(client.focus).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/admin/calendar");
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("opens a window when focusing the existing client fails", async () => {
    const client: WindowClientFake = { url: `${ORIGIN}/`, focus: vi.fn().mockRejectedValue(new Error("no focus")) };
    const sw = loadServiceWorker([client]);
    await dispatch(sw.listeners.get("notificationclick"), clickEvent("/admin/calendar"));
    expect(sw.openWindow).toHaveBeenCalledWith("/admin/calendar");
  });
});
