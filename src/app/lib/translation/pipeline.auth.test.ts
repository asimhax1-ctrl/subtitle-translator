import { expect, test, vi } from "vitest";
import { translateLines, type PipelineRuntimeConfig } from "./pipeline";

const config: PipelineRuntimeConfig = {
  translationMethod: "deepseek",
  sourceLanguage: "en",
  targetLanguage: "ar",
  useCache: false,
  batchSize: 1,
  retryCount: 0,
  delayTime: 1,
};

test("a gateway authentication message soft-fails one line without cancelling peers", async () => {
  const error = Object.assign(new Error("authentication service unavailable"), { status: 502 });
  const translate = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("مرحبا");
  const outcome = await translateLines(["First", "Hello"], config, { translate });

  expect(translate).toHaveBeenCalledTimes(2);
  expect(outcome.lines).toEqual(["First", "مرحبا"]);
  expect(outcome.failures).toEqual([expect.objectContaining({ index: 0, text: "First" })]);
  expect(outcome.lastError).toBe(error);
});

test("HTTP gateway authentication errors preserve their status and do not cancel peers", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "authentication service unavailable" } }), { status: 502 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "مرحبا" } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  try {
    const outcome = await translateLines(["First", "Hello"], { ...config, apiKey: "fixture-only", useRelay: false }, {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.lines).toEqual(["First", "مرحبا"]);
    expect(outcome.failures).toEqual([expect.objectContaining({ index: 0, text: "First" })]);
    expect(outcome.lastError).toMatchObject({ status: 502, message: "[502] authentication service unavailable" });
  } finally {
    vi.unstubAllGlobals();
  }
});

test.each([401, 403])("HTTP %s still aborts the run before queued requests execute", async (status) => {
  const error = Object.assign(new Error("Credentials rejected"), { status });
  const translate = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("مرحبا");

  await expect(translateLines(["First", "Hello"], config, { translate })).rejects.toBe(error);
  expect(translate).toHaveBeenCalledTimes(1);
});
