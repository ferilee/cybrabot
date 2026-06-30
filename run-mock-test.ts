import app from "./api/index.ts";

async function run() {
  console.log("Mocking requireApiSession...");
  const webAuth = require("./lib/web-auth.ts");
  webAuth.requireApiSession = async () => ({
    email: "test@example.com",
    name: "Test",
    role: "admin"
  });
  
  console.log("Mocking requireCompleteWebAccount...");
  const webUsers = require("./lib/web-users.ts");
  webAuth.requireCompleteWebAccount = async () => ({
    email: "test@example.com",
    fullName: "Test",
  });
  webUsers.consumeWebChatQuota = async () => ({
    ok: true,
    reason: null,
    quota: { remaining: 5, limit: 5 }
  });

  const req = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "halo" })
  });

  console.log("Sending POST to mocked API...");
  try {
    const res = await app.fetch(req);
    console.log("Status:", res.status);
    console.log("Body:", await res.text());
  } catch(e) {
    console.error("Error:", e);
  }
}

run();
