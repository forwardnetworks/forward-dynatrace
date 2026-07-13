#!/usr/bin/env node

import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

import { buildCaptureEvidence } from "./build-demo-capture-evidence.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const distDir = path.join(root, "dist");
const uiDir = path.join(distDir, "ui");
const screenshotDir = path.join(root, "docs/assets/screenshots");
const demoQueryId = "FQ_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

const parseBody = async (request) =>
  new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });

const send = (response, statusCode, body, contentType = "application/json; charset=utf-8") => {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  response.end(body);
};

const sendJson = (response, statusCode, payload) => {
  send(response, statusCode, JSON.stringify(payload), "application/json; charset=utf-8");
};

const loadFunctions = async () => {
  const networkProof = await import(pathToFileURL(path.join(distDir, "api/network-proof.js")));
  const forwardSync = await import(pathToFileURL(path.join(distDir, "api/forward-sync.js")));
  const forwardStatus = await import(pathToFileURL(path.join(distDir, "api/forward-status.js")));
  const forwardNqePreview = await import(
    pathToFileURL(path.join(distDir, "api/forward-nqe-preview.js"))
  );
  return {
    networkProof: networkProof.default,
    forwardSync: forwardSync.default,
    forwardStatus: forwardStatus.default,
    forwardNqePreview: forwardNqePreview.buildForwardNqePreview,
  };
};

const fakeForwardNqeFetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body || "{}"));
  const parameters = body.parameters || {};
  const source = parameters.source || "source";
  const destination = parameters.destination || "destination";
  return new Response(
    JSON.stringify({
      snapshotId: "snapshot-demo",
      totalNumItems: 2,
      items: [
        {
          endpointRole: "source",
          endpoint: source,
          matchCount: 1,
          status: "resolved",
        },
        {
          endpointRole: "destination",
          endpoint: destination,
          matchCount: 1,
          status: "resolved",
        },
      ],
    }),
    {
      headers: { "Content-Type": "application/json" },
      status: 200,
    },
  );
};

const startDemoServer = async () => {
  const functions = await loadFunctions();
  process.env.FORWARD_NQE_ALLOWED_QUERY_IDS = demoQueryId;
  process.env.FORWARD_NQE_READONLY_AUTHORIZATION = "Basic demo-read-only";

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (request.method === "POST" && url.pathname.startsWith("/api/")) {
        const rawBody = await parseBody(request);
        const payload = rawBody?.data ?? rawBody;
        if (url.pathname === "/api/network-proof") {
          sendJson(response, 200, await functions.networkProof(payload));
          return;
        }
        if (url.pathname === "/api/forward-sync") {
          sendJson(response, 200, await functions.forwardSync(payload));
          return;
        }
        if (url.pathname === "/api/forward-status") {
          sendJson(response, 200, await functions.forwardStatus(payload));
          return;
        }
        if (url.pathname === "/api/forward-nqe-preview") {
          sendJson(
            response,
            200,
            await functions.forwardNqePreview(payload, fakeForwardNqeFetch),
          );
          return;
        }
      }

      if (request.method !== "GET") {
        sendJson(response, 405, { error: "method_not_allowed" });
        return;
      }

      if (url.pathname === "/") {
        response.writeHead(302, { Location: "/ui/" });
        response.end();
        return;
      }

      if (url.pathname === "/platform/runtime/runtime-loader.js") {
        send(response, 200, "globalThis.__FORWARD_DYNATRACE_DEMO_RUNTIME__ = true;\n");
        return;
      }

      const requestedPath =
        url.pathname === "/ui/" ? "/ui/index.html" : decodeURIComponent(url.pathname);
      const filePath = path.normalize(path.join(distDir, requestedPath));
      if (!filePath.startsWith(distDir)) {
        sendJson(response, 403, { error: "forbidden" });
        return;
      }
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        sendJson(response, 404, { error: "not_found" });
        return;
      }
      const extension = path.extname(filePath);
      send(
        response,
        200,
        await readFile(filePath),
        contentTypes.get(extension) || "application/octet-stream",
      );
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
};

const markScrollRoot = async (page) => {
  await page.evaluate(() => {
    const scrollRoot = Array.from(document.querySelectorAll("body, body *")).find(
      (element) =>
        element.scrollHeight > element.clientHeight + 20 &&
        getComputedStyle(element).overflowY === "auto",
    );
    scrollRoot?.setAttribute("data-capture-scroll-root", "true");
  });
};

const scrollRootTo = async (page, top) => {
  await page.locator("[data-capture-scroll-root=true]").evaluate((element, scrollTop) => {
    element.scrollTop = scrollTop;
  }, top);
  await page.waitForTimeout(250);
};

const scrollToPanel = async (page, text) => {
  await page.getByText(text, { exact: true }).first().evaluate((node) => {
    const root = document.querySelector("[data-capture-scroll-root=true]");
    const panel = node.closest(".panel") || node;
    if (!root) {
      panel.scrollIntoView();
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    root.scrollTop += panelRect.top - rootRect.top - 20;
  });
  await page.waitForTimeout(250);
};

const scrollToText = async (page, text, offset = 20) => {
  await page.getByText(text, { exact: true }).first().evaluate((node, scrollOffset) => {
    const root = document.querySelector("[data-capture-scroll-root=true]");
    if (!root) {
      node.scrollIntoView();
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    root.scrollTop += nodeRect.top - rootRect.top - Number(scrollOffset);
  }, offset);
  await page.waitForTimeout(250);
};

const capture = async (page, fileName) => {
  await page.screenshot({
    animations: "disabled",
    path: path.join(screenshotDir, fileName),
    quality: 90,
    type: "jpeg",
  });
};

const captureElement = async (locator, fileName) => {
  await locator.screenshot({
    animations: "disabled",
    path: path.join(screenshotDir, fileName),
    quality: 90,
    type: "jpeg",
  });
};

const assertAssuranceCaptureReady = async (page) => {
  const table = page.locator(".change-comparison-section .evidence-table-wrap");
  const dimensions = await table.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  if (dimensions.scrollWidth > dimensions.clientWidth + 1) {
    throw new Error(
      `ServiceNow assurance table is horizontally clipped (${dimensions.scrollWidth}px > ${dimensions.clientWidth}px).`,
    );
  }
  const labels = await page.locator(".change-comparison-section .evidence-reason").allTextContents();
  for (const expected of [
    "All validation passed",
    "Blocked paths",
    "Path regression",
    "Service unhealthy",
    "Open problems",
  ]) {
    if (!labels.includes(expected)) {
      throw new Error(`ServiceNow assurance capture is missing the reason label: ${expected}.`);
    }
  }
};

const main = async () => {
  await stat(path.join(uiDir, "index.html")).catch(() => {
    throw new Error("dist/ui/index.html is missing. Run npm run build first.");
  });

  const rehearsalDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-capture-rehearsal-"));
  const captureEvidence = await buildCaptureEvidence(rehearsalDir);
  const server = await startDemoServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { height: 1200, width: 1440 } });
    await page.addInitScript((evidence) => {
      globalThis.__FORWARD_DYNATRACE_CAPTURE_EVIDENCE__ = evidence;
    }, captureEvidence);
    await page.goto(`${server.baseUrl}/ui/`, { waitUntil: "networkidle" });
    await markScrollRoot(page);
    await page.getByText("Checked replay dependency data", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Review change assurance" }).waitFor();
    if (await page.getByText(/Live query failed:/u).count()) {
      throw new Error("Overview capture must not contain a failed live query.");
    }
    for (const expected of ["reconciled", "consistent-with-network-policy-block", "FAIL", "FAIL_TO_PASS", "critical"]) {
      await page.getByText(expected, { exact: true }).first().waitFor();
    }
    await capture(page, "01-overview.jpg");

    await page.getByRole("button", { name: "Review change assurance" }).click();
    await page.waitForFunction(() => {
      const root = document.querySelector("[data-capture-scroll-root=true]");
      const section = document.querySelector(".change-comparison-section");
      if (!root || !section) return false;
      const rootRect = root.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      return sectionRect.bottom > rootRect.top && sectionRect.top < rootRect.bottom;
    });
    await scrollRootTo(page, 0);

    const fields = page.getByRole("textbox");
    await fields.nth(1).fill("https://forward.example.com");
    await fields.nth(2).fill("123");
    await fields.nth(3).fill(demoQueryId);

    await page.getByRole("button", { name: "Check endpoint mapping" }).click();
    await page.getByText("Forward resolved both dependency endpoints.").first().waitFor();
    await scrollToPanel(page, "Forward Host Resolution And Path Evidence");
    await capture(page, "02-export-package-readiness.jpg");

    await scrollRootTo(page, 0);
    await page.getByRole("button", { name: "Build resolved package" }).click();
    await page.getByText("Forward bulk intent package is ready.").waitFor();
    await scrollToPanel(page, "Forward-Centric Ingest Package");
    await capture(page, "03-forward-side-api.jpg");

    await scrollToText(page, "Bulk intent check payload sample", 80);
    await captureElement(page.locator(".intent-preview"), "04-intent-check-payload.jpg");

    await scrollToText(page, "ServiceNow → Forward → Dynatrace assurance history", 80);
    await assertAssuranceCaptureReady(page);
    await captureElement(
      page.locator(".change-comparison-section"),
      "05-servicenow-change-assurance.jpg",
    );

    process.stdout.write(
      JSON.stringify(
        {
          status: "ok",
          baseUrl: server.baseUrl,
          screenshots: [
            "docs/assets/screenshots/01-overview.jpg",
            "docs/assets/screenshots/02-export-package-readiness.jpg",
            "docs/assets/screenshots/03-forward-side-api.jpg",
            "docs/assets/screenshots/04-intent-check-payload.jpg",
            "docs/assets/screenshots/05-servicenow-change-assurance.jpg",
          ],
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await browser.close();
    await server.close();
    await rm(rehearsalDir, { recursive: true, force: true });
  }
};

const run = async () => {
  if (!process.argv.includes("--serve")) {
    await main();
    return;
  }

  const server = await startDemoServer();
  process.stdout.write(`${server.baseUrl}/ui/\n`);
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await server.close();
};

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exit(1);
});
