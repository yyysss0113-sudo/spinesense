const https = require("https");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { apiKey, payload } = req.body;
    const bodyStr = JSON.stringify(payload);

    const result = await new Promise((resolve, reject) => {
      const request = https.request({
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      }, (response) => {
        let data = "";
        response.on("data", chunk => data += chunk);
        response.on("end", () => resolve({ status: response.statusCode, body: data }));
      });
      request.on("error", reject);
      request.write(bodyStr);
      request.end();
    });

    res.status(result.status).send(result.body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
