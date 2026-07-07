import { createServer } from "node:http";

import { createHealthStatus } from "@harbor/shared";

const port = Number.parseInt(process.env.HARBOR_API_PORT ?? "3001", 10);

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(createHealthStatus("@harbor/api")));
    return;
  }

  response.statusCode = 404;
  response.end("Not Found");
});

server.listen(port, () => {
  console.log(`Harbor API placeholder listening on port ${port}`);
});
