import { fetch } from "bun";
async function test() {
  console.log("Sending POST to live server...");
  const abortController = new AbortController();
  const id = setTimeout(() => abortController.abort(), 10000);
  try {
    const res = await fetch("https://asisten.ferilee.gurumuda.eu.org/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "halo test" }),
      signal: abortController.signal
    });
    clearTimeout(id);
    console.log("Status:", res.status);
    console.log("Body:", await res.text());
  } catch (err) {
    console.error("Error:", err);
  }
}
test();
