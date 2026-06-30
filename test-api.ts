import app from "./api/index.ts";

async function test() {
  const req = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": "cybra-web-session=123" // Invalid session
    },
    body: JSON.stringify({ message: "halo" })
  });
  
  const res = await app.fetch(req);
  console.log(res.status, await res.text());
}

test();
