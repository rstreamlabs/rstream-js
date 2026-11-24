# Write and read a file through a WebTTY sidecar

This Node.js example writes `codex-note.txt` at the root of a WebTTY WebDAV
sidecar, lists the directory and reads the file through both text and streaming
methods. Use a disposable writable export. The write overwrites an existing
file of the same name.

[Build the checkout](../../../../docs/000-building-from-source.md) so this
sample can load its local SDK dependency. Use an authorized HTTPS endpoint
with a writable WebDAV sidecar at `/fs`. The
[sidecar guide](https://rstream.io/docs/webtty/quickstart#add-a-filesystem-sidecar)
explains server setup. If your endpoint advertises another `fs_path`, pass
it as `fsPath` in the sample.

From this directory, copy the example environment file.

```sh
cp .env.local.example .env.local
```

Set `RSTREAM_WEBTTY_URL` in `.env.local` to the authorized URL, then run the sample.

```sh
npm install
npm start
```

Expect the listing to contain `codex-note.txt` and both reads to print
`written through rstream WebTTY`. The process exits after the reads. Delete
the sample file from the export and remove the local credential file.
