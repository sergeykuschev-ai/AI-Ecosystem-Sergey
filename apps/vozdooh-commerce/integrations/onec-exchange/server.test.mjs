import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { afterEach, test } from "node:test";
import { createExchangeServer } from "./server.mjs";

const KEYS = [
  "ONEC_EXCHANGE_ENABLED",
  "ONEC_EXCHANGE_USERNAME",
  "ONEC_EXCHANGE_PASSWORD",
  "ONEC_EXCHANGE_STORAGE_DIR",
  "ONEC_EXCHANGE_FILE_LIMIT",
  "ONEC_EXCHANGE_MAX_FILE_SIZE",
];
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let storageDir = null;
let server = null;

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
  if (storageDir) await rm(storageDir, { recursive: true, force: true });
  storageDir = null;
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});
async function start(enabled = true) {
  storageDir = await mkdtemp(join(tmpdir(), "vozdooh-onec-"));
  process.env.ONEC_EXCHANGE_ENABLED = String(enabled);
  process.env.ONEC_EXCHANGE_USERNAME = "vozdooh-test";
  process.env.ONEC_EXCHANGE_PASSWORD = "test-password";
  process.env.ONEC_EXCHANGE_STORAGE_DIR = storageDir;
  process.env.ONEC_EXCHANGE_FILE_LIMIT = "1024";
  process.env.ONEC_EXCHANGE_MAX_FILE_SIZE = "4096";
  server = createExchangeServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

function basic(username = "vozdooh-test", password = "test-password") {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

test("disabled receiver stays closed", async () => {
  const base = await start(false);
  const response = await fetch(`${base}/api/1c/exchange?type=catalog&mode=checkauth`);
  assert.equal(response.status, 404);
});
test("CommerceML auth, init, upload and staging work end to end", async () => {
  const base = await start(true);
  const wrong = await fetch(`${base}/api/1c/exchange?type=catalog&mode=checkauth`, {
    headers: { Authorization: basic("wrong", "wrong") },
  });
  assert.equal(wrong.status, 401);

  const auth = await fetch(`${base}/api/1c/exchange?type=catalog&mode=checkauth`, {
    headers: { Authorization: basic() },
  });
  assert.equal(auth.status, 200);
  assert.match(await auth.text(), /^success\nvozdooh_1c_session\n/);
  const setCookie = auth.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookie = setCookie.split(";")[0];

  const init = await fetch(`${base}/api/1c/exchange?type=catalog&mode=init`, {
    headers: { Cookie: cookie },
  });
  assert.equal(await init.text(), "zip=no\nfile_limit=1024");
  const upload = `${base}/api/1c/exchange?type=catalog&mode=file&filename=import.xml`;
  for (const chunk of ["<КоммерческаяИнформация>", "</КоммерческаяИнформация>"]) {
    const response = await fetch(upload, {
      method: "POST",
      headers: { Cookie: cookie },
      body: chunk,
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "success");
  }

  const imported = await fetch(
    `${base}/api/1c/exchange?type=catalog&mode=import&filename=import.xml`,
    { headers: { Cookie: cookie } },
  );
  assert.equal(imported.status, 200);
  assert.equal(await imported.text(), "success");

  const dirs = await readdir(storageDir);
  assert.equal(dirs.length, 1);
  const sessionPath = join(storageDir, dirs[0]);
  assert.equal(
    await readFile(join(sessionPath, "import.xml"), "utf8"),
    "<КоммерческаяИнформация></КоммерческаяИнформация>",
  );
  const manifest = await readFile(join(sessionPath, "imports.jsonl"), "utf8");
  assert.match(manifest, /"filename":"import.xml"/);
  assert.match(manifest, /"state":"staged"/);

  const traversal = await fetch(
    `${base}/api/1c/exchange?type=catalog&mode=file&filename=../secret.xml`,
    { method: "POST", headers: { Cookie: cookie }, body: "x" },
  );
  assert.equal(traversal.status, 400);
  assert.match(await traversal.text(), /^failure\ninvalid filename$/);

  const orders = await fetch(
    `${base}/api/1c/exchange?type=sale&mode=checkauth`,
    { headers: { Authorization: basic() } },
  );
  assert.equal(orders.status, 400);
  assert.match(await orders.text(), /only catalog exchange is enabled/);
});
