import { createServer as createHttpServer, type Server } from "node:http";

export async function startWorkflowFixtureServer(): Promise<{
  readonly server: Server;
  readonly url: string;
}> {
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/upload-validation") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <html>
          <head><title>Upload validation fixture</title></head>
          <body>
            <main>
              <h1>Upload validation fixture</h1>
              <label>Upload <input id="upload" type="file"></label>
              <p>Received filename: <span id="received-filename">No file</span></p>
              <p>Received type: <span id="received-type"></span></p>
              <p id="upload-error"></p>
              <button id="save" type="button" disabled>Save</button>
            </main>
            <script>
              const expectedTypeByExtension = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".bmp": "image/bmp"
              };
              const upload = document.querySelector("#upload");
              const filename = document.querySelector("#received-filename");
              const type = document.querySelector("#received-type");
              const error = document.querySelector("#upload-error");
              const save = document.querySelector("#save");
              upload.addEventListener("change", () => {
                const file = upload.files[0];
                filename.textContent = file?.name ?? "No file";
                type.textContent = file?.type ?? "";
                const extension = file === undefined ? "" : file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
                const expectedType = expectedTypeByExtension[extension];
                const accepted = file !== undefined && expectedType !== undefined && file.type === expectedType;
                error.textContent = accepted ? "" : "Unsupported file type";
                save.disabled = !accepted;
              });
            </script>
          </body>
        </html>`);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port.");
  }

  return {
    server,
    url: `http://127.0.0.1:${String(address.port)}/`,
  };
}
